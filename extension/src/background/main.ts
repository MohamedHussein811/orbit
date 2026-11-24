// Shields: counts what the browser's rule engine really blocked, and applies per-site switches.
// Daily totals are stored. Per-tab totals and the hosts blocked in each tab stay in memory (session
// storage) until the tab navigates or closes, so the Shields panel can list them. Full URLs never
// are kept.

import { addCount, emptyCounts, emptyStats, pruneStats, sanitizeStats, type Category, type Counts } from "../shared/stats.ts";
import { sanitizePrivacy } from "../shared/privacy.ts";
import { addBlockedHost, allowRule, blockedList, categoryOfMatch, emptyBlockedHosts, cosmeticCss, cosmeticShard, hostSuffixes, normalizeHosts, siteOf, type BlockedHosts, type Message, type SiteCosmetic, type TabState } from "../shared/shields.ts";
import { applyContentScripts, applyThreats, applyWebRtc, readHidingExceptions, readPrivacy, runStartupCleanup } from "./privacy.ts";
import { checkForUpdate, scheduleUpdateCheck, UPDATE_ALARM } from "./updates.ts";
import { seedDefaultShortcuts } from "../shared/default-shortcuts.ts";
import { browserStartup } from "../shared/search.ts";
import { planStartup, type OpenTab } from "../shared/startup.ts";

const FLUSH_DELAY_MS = 500;
const DYNAMIC_ALLOW_RULE = 1;
const SESSION_PRIVATE_RULE = 1;
const SESSION_CONTINUE_RULE = 2;

let pending: Counts = emptyCounts();
const tabPending = new Map<number, Counts>();
const tabHostsPending = new Map<number, BlockedHosts>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writes: Promise<unknown> = Promise.resolve();

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = writes.then(work, work);
  writes = next.catch(() => {});
  return next;
}

// The page each tab shows now. A page that is closing or being left still sends requests (such as
// analytics beacons), and those blocks count in the totals but not for the tab's next page.
const tabDocuments = new Map<number, string>();
const NAVIGATING = "navigating";

// Every new page in a tab, a reload included, starts from zero blocked and gets its Shields button
// and site hiding again: the browser resets a tab's button state on each navigation.
chrome.webNavigation.onBeforeNavigate.addListener(({ tabId, frameId }) => {
  if (frameId !== 0 || tabId < 0) return;
  tabDocuments.set(tabId, NAVIGATING);
  void clearTab(tabId).then(() => showBadge(tabId, emptyCounts()));
});

chrome.webNavigation.onCommitted.addListener(({ tabId, frameId, documentId, url }) => {
  if (frameId !== 0 || tabId < 0) return;
  if (documentId) tabDocuments.set(tabId, documentId);
  void syncAction(tabId, url);
  void hideOnSite(tabId, url);
});

function countsForTab(request: chrome.declarativeNetRequest.RequestDetails): boolean {
  if (request.tabId < 0) return false;
  if (request.documentLifecycle && request.documentLifecycle !== "active") return false;
  if (request.type === "main_frame" || request.frameId !== 0 || !request.documentId) return true;
  const current = tabDocuments.get(request.tabId);
  return !current || current === request.documentId;
}

chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(({ request, rule }) => {
  const category = categoryOfMatch(rule.rulesetId, rule.ruleId);
  if (!category) return;
  pending[category]++;
  if (countsForTab(request)) {
    const counts = tabPending.get(request.tabId) ?? emptyCounts();
    counts[category]++;
    tabPending.set(request.tabId, counts);
    const hosts = tabHostsPending.get(request.tabId) ?? emptyBlockedHosts();
    addBlockedHost(hosts, category, request.url);
    tabHostsPending.set(request.tabId, hosts);
  }
  flushTimer ??= setTimeout(flush, FLUSH_DELAY_MS);
});

function flush(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const daily = pending;
  const byTab = new Map(tabPending);
  const hostsByTab = new Map(tabHostsPending);
  pending = emptyCounts();
  tabPending.clear();
  tabHostsPending.clear();
  return serialized(async () => {
    const now = Date.now();
    const { stats, tabCounts, tabHosts } = await readStored();
    for (const category of Object.keys(daily) as Category[]) {
      if (daily[category] > 0) addCount(stats, category, daily[category], now);
    }
    pruneStats(stats, now);
    await chrome.storage.local.set({ stats });
    for (const [tabId, counts] of byTab) {
      const total = (tabCounts[tabId] ??= emptyCounts());
      for (const category of Object.keys(counts) as Category[]) total[category] += counts[category];
    }
    for (const [tabId, hosts] of hostsByTab) {
      const total = (tabHosts[tabId] ??= emptyBlockedHosts());
      for (const category of Object.keys(hosts) as Category[]) {
        for (const [host, count] of Object.entries(hosts[category])) addBlockedHost(total, category, `https://${host}/`, count);
      }
    }
    await chrome.storage.session.set({ tabCounts, tabHosts });
    await Promise.all([...byTab.keys()].map((tabId) => showBadge(tabId, tabCounts[tabId]!)));
  });
}

async function readStored(): Promise<{ stats: ReturnType<typeof sanitizeStats>; tabCounts: Record<number, Counts>; tabHosts: Record<number, BlockedHosts> }> {
  const [{ stats }, { tabCounts, tabHosts }] = await Promise.all([chrome.storage.local.get("stats"), chrome.storage.session.get(["tabCounts", "tabHosts"])]);
  return {
    stats: sanitizeStats(stats),
    tabCounts: (tabCounts as Record<number, Counts> | undefined) ?? {},
    tabHosts: (tabHosts as Record<number, BlockedHosts> | undefined) ?? {},
  };
}

function showBadge(tabId: number, counts: Counts): Promise<void> {
  const total = counts.ads + counts.trackers + counts.threats;
  const text = total === 0 ? "" : total > 999 ? "999+" : String(total);
  return chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

function clearTab(tabId: number): Promise<void> {
  tabPending.delete(tabId);
  tabHostsPending.delete(tabId);
  return serialized(async () => {
    const { tabCounts, tabHosts } = await readStored();
    if (tabCounts[tabId] || tabHosts[tabId]) {
      delete tabCounts[tabId];
      delete tabHosts[tabId];
      await chrome.storage.session.set({ tabCounts, tabHosts });
    }
  });
}

// Shields works on web pages only, so on the new tab page and other browser pages its button
// rests, greyed out. The button is on by default, so a tab whose state the browser has reset still
// opens the Shields panel.
function syncAction(tabId: number, url: string | undefined): Promise<void> {
  return (siteOf(url) ? chrome.action.enable(tabId) : chrome.action.disable(tabId)).catch(() => {});
}

void chrome.action.enable().catch(() => {});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url) void syncAction(tabId, change.url);
});

// Hiding leftover ad space on sites that have their own hiding rules
const shardCache = new Map<number, Record<string, SiteCosmetic>>();

async function readShard(index: number): Promise<Record<string, SiteCosmetic>> {
  let shard = shardCache.get(index);
  if (!shard) {
    const response = await fetch(chrome.runtime.getURL(`rules/cosmetic/${index}.json`));
    shard = (await response.json()) as Record<string, SiteCosmetic>;
    shardCache.set(index, shard);
  }
  return shard;
}

async function hideOnSite(tabId: number, url: string): Promise<void> {
  const host = siteOf(url);
  if (!host) return;
  const off = [...(await hostsOff()), ...(await privateHostsOff())];
  const { specific } = await readHidingExceptions();
  if (hostSuffixes(host).some((suffix) => off.includes(suffix) || specific.includes(suffix))) return;
  const entries: SiteCosmetic[] = [];
  for (const suffix of hostSuffixes(host)) {
    const entry = (await readShard(cosmeticShard(suffix)))[suffix];
    if (entry) entries.push(entry);
  }
  if (entries.length === 0) return;
  await chrome.scripting.insertCSS({ target: { tabId }, css: cosmeticCss(entries), origin: "USER" }).catch(() => {});
}

// Pop-ups: the rule engine cannot see them, so a tab a page opens is closed when it goes to a host
// the filter lists name as a pop-up or ad server. Shields off for the opening site lets it through.
const POPUP_WATCH_MS = 15_000;
const openedBy = new Map<number, { source: number; at: number }>();
let popupList: Promise<{ hosts: Set<string>; scoped: Record<string, string[]> }> | null = null;

function popups(): Promise<{ hosts: Set<string>; scoped: Record<string, string[]> }> {
  popupList ??= fetch(chrome.runtime.getURL("rules/popups.json"))
    .then((response) => response.json() as Promise<{ hosts: string[]; scoped: Record<string, string[]> }>)
    .then((list) => ({ hosts: new Set(list.hosts), scoped: list.scoped }))
    .catch(() => ({ hosts: new Set<string>(), scoped: {} }));
  return popupList;
}

async function checkPopup(tabId: number, url: string): Promise<void> {
  const opener = openedBy.get(tabId);
  const host = siteOf(url);
  if (!opener || !host || Date.now() - opener.at > POPUP_WATCH_MS) return;
  const source = await chrome.tabs.get(opener.source).catch(() => null);
  const sourceHost = siteOf(source?.url);
  if (!sourceHost || sourceHost === host) return;
  const off = [...(await hostsOff()), ...(await privateHostsOff())];
  if (hostSuffixes(sourceHost).some((suffix) => off.includes(suffix))) return;
  const { hosts, scoped } = await popups();
  const listed = hostSuffixes(host).some((suffix) => hosts.has(suffix) || (scoped[suffix] ?? []).some((site) => hostSuffixes(sourceHost).includes(site)));
  if (!listed) return;
  await closePopup(tabId, opener.source, url);
}

async function closePopup(tabId: number, source: number, url: string): Promise<void> {
  if (!openedBy.has(tabId)) return;
  openedBy.delete(tabId);
  await chrome.tabs.remove(tabId).catch(() => {});
  pending.ads++;
  const counts = tabPending.get(source) ?? emptyCounts();
  counts.ads++;
  tabPending.set(source, counts);
  const blocked = tabHostsPending.get(source) ?? emptyBlockedHosts();
  addBlockedHost(blocked, "ads", url);
  tabHostsPending.set(source, blocked);
  flushTimer ??= setTimeout(flush, FLUSH_DELAY_MS);
}

// Pop-unders: a page opens a tab behind the one the person is looking at. A tab opened in the
// background without the person asking for it (sites/intent.ts reports middle and Ctrl clicks and
// the link menu) is closed when it goes to another site.
const POPUNDER_SETTLE_MS = 400;
// Long enough to pick "Open link in new tab" from the link menu.
const INTENT_MS = 10_000;
const openIntent = new Map<number, number>();

const sameSite = (a: string, b: string) => hostSuffixes(a).some((suffix) => hostSuffixes(b).includes(suffix));

async function checkPopunder(tabId: number, sourceTabId: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, POPUNDER_SETTLE_MS));
  if (Date.now() - (openIntent.get(sourceTabId) ?? 0) < INTENT_MS) return;
  const [tab, source] = await Promise.all([chrome.tabs.get(tabId).catch(() => null), chrome.tabs.get(sourceTabId).catch(() => null)]);
  if (!tab || !source || tab.active || !source.active || tab.windowId !== source.windowId) return;
  const sourceHost = siteOf(source.url);
  if (!sourceHost) return;
  const url = tab.pendingUrl || tab.url || "";
  const host = siteOf(url);
  if (host && sameSite(host, sourceHost)) return;
  const off = [...(await hostsOff()), ...(await privateHostsOff())];
  if (hostSuffixes(sourceHost).some((suffix) => off.includes(suffix))) return;
  await closePopup(tabId, sourceTabId, url);
}

chrome.webNavigation.onCreatedNavigationTarget.addListener(({ sourceTabId, tabId, url }) => {
  openedBy.set(tabId, { source: sourceTabId, at: Date.now() });
  void checkPopup(tabId, url);
  void checkPopunder(tabId, sourceTabId);
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url && openedBy.has(tabId)) void checkPopup(tabId, change.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  openedBy.delete(tabId);
  openIntent.delete(tabId);
  tabDocuments.delete(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void clearTab(tabId);
});

// Per-site switches
async function hostsOff(): Promise<string[]> {
  const { sitesOff } = await chrome.storage.local.get("sitesOff");
  return normalizeHosts(sitesOff);
}

async function privateHostsOff(): Promise<string[]> {
  const { privateSitesOff } = await chrome.storage.session.get("privateSitesOff");
  return normalizeHosts(privateSitesOff);
}

async function applyPersistentRules(hosts: string[]): Promise<void> {
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [DYNAMIC_ALLOW_RULE],
    addRules: hosts.length ? [allowRule(DYNAMIC_ALLOW_RULE, hosts)] : [],
  });
}

async function applySessionRule(id: number, hosts: string[]): Promise<void> {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [id],
    addRules: hosts.length ? [allowRule(id, hosts)] : [],
  });
}

/** Sites with Shields off in any window. Content scripts cannot tell windows apart, so a site turned
 * off in a private window runs without them everywhere until the last private window closes. */
async function allHostsOff(): Promise<string[]> {
  return normalizeHosts([...(await hostsOff()), ...(await privateHostsOff())]);
}

/** A choice made in a private window lasts only for this session and never reaches the profile. */
async function setShields(host: string, enabled: boolean, incognito: boolean): Promise<void> {
  const change = (hosts: string[]) => normalizeHosts(enabled ? hosts.filter((h) => h !== host) : [...hosts, host]);
  if (incognito) {
    const privateSitesOff = change(await privateHostsOff());
    await chrome.storage.session.set({ privateSitesOff });
    await applySessionRule(SESSION_PRIVATE_RULE, privateSitesOff);
  } else {
    const sitesOff = change(await hostsOff());
    await chrome.storage.local.set({ sitesOff });
    await applyPersistentRules(sitesOff);
  }
  await applyContentScripts(await readPrivacy(), await allHostsOff());
}

/** The switch in the Shields panel: applies the choice, then reloads the page from here, so closing
 * the panel early cannot leave the page in its old state. */
async function switchShields(tabId: number | undefined, host: string, enabled: boolean, incognito: boolean): Promise<void> {
  await setShields(host, enabled, incognito);
  if (tabId === undefined) return;
  await clearTab(tabId);
  await showBadge(tabId, emptyCounts());
  await chrome.tabs.reload(tabId).catch(() => {});
}

chrome.windows.onRemoved.addListener(() => {
  void (async () => {
    const windows = await chrome.windows.getAll();
    if (windows.some((window) => window.incognito)) return;
    const { privateSitesOff } = await chrome.storage.session.get("privateSitesOff");
    if (!normalizeHosts(privateSitesOff).length) return;
    await chrome.storage.session.remove("privateSitesOff");
    await applySessionRule(SESSION_PRIVATE_RULE, []);
    await applyContentScripts(await readPrivacy(), await hostsOff());
  })();
});

async function continueToSite(host: string): Promise<void> {
  const { continuedSites } = await chrome.storage.session.get("continuedSites");
  const hosts = normalizeHosts([...normalizeHosts(continuedSites), host]);
  await chrome.storage.session.set({ continuedSites: hosts });
  await applySessionRule(SESSION_CONTINUE_RULE, hosts);
}

chrome.runtime.onMessage.addListener((message: Message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (message.type === "open-intent") {
    if (sender.tab?.id !== undefined) openIntent.set(sender.tab.id, Date.now());
    return false;
  }
  handle(message).then(respond, (error: Error) => respond({ error: error.message }));
  return true;
});

async function handle(message: Message): Promise<unknown> {
  switch (message.type) {
    case "tab-state": {
      await flush();
      const [{ tabCounts, tabHosts }, regular, privateHosts, tab] = await Promise.all([readStored(), hostsOff(), privateHostsOff(), chrome.tabs.get(message.tabId).catch(() => null)]);
      // Browser pages have no blocking, so nothing is listed for them.
      const web = Boolean(siteOf(tab?.url));
      const hosts = (web && tabHosts[message.tabId]) || emptyBlockedHosts();
      const state: TabState = {
        counts: (web && tabCounts[message.tabId]) || emptyCounts(),
        blocked: { ads: blockedList(hosts.ads), trackers: blockedList(hosts.trackers), threats: blockedList(hosts.threats) },
        sitesOff: tab?.incognito ? [...regular, ...privateHosts] : regular,
      };
      return state;
    }
    case "set-shields":
      await switchShields(message.tabId, message.host, message.enabled, message.incognito);
      return { ok: true };
    case "continue-to-site":
      await continueToSite(message.host);
      return { ok: true };
    case "set-privacy": {
      const privacy = sanitizePrivacy(message.settings);
      await chrome.storage.local.set({ privacy });
      if (!privacy.checkUpdates) await chrome.storage.local.remove("update");
      await applyWebRtc(privacy);
      await applyThreats(privacy);
      await applyContentScripts(privacy, await allHostsOff());
      return { ok: true };
    }
    case "reset-stats":
      await flush();
      await serialized(() => chrome.storage.local.set({ stats: emptyStats() }));
      return { ok: true };
    default:
      throw new Error("unknown message");
  }
}

async function applyAll(): Promise<void> {
  const privacy = await readPrivacy();
  await applyWebRtc(privacy);
  await applyThreats(privacy);
  await applyContentScripts(privacy, await allHostsOff());
}

/** What Orbit for Android shows for a new tab until this extension's page is registered
 * (tools/android/patches/orbit-android-ntp.patch). */
const ANDROID_PLACEHOLDER = /^data:text\/html;orbit=new-tab[;,]/;

/** Puts Orbit's page in tabs still showing the Android placeholder, in place. */
async function replacePlaceholderTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && ANDROID_PLACEHOLDER.test(tab.url ?? ""))
      .map((tab) => chrome.tabs.update(tab.id!, { url: "chrome://newtab/" }).catch(() => undefined)),
  );
}

/** Tabs opened before this extension finished installing show Chromium's own new tab page
 * (chrome-native://newtab/ or Orbit's placeholder on Android). A new tab in the same place shows Orbit's page instead.
 * On a new desktop profile the first of them shows Orbit's welcome tour, once; the tour is about
 * desktop features, so Android goes straight to the new tab page. */
async function takeOverNewTabs(welcome: boolean): Promise<void> {
  if ((await chrome.runtime.getPlatformInfo()).os === "android") welcome = false;
  const tabs = await chrome.tabs.query({});
  const chromiumNewTab = /^chrome(-native)?:\/\/(newtab|new-tab-page)\//;
  const isNewTab = (url = "") => chromiumNewTab.test(url) || ANDROID_PLACEHOLDER.test(url);
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && (isNewTab(tab.url) || isNewTab(tab.pendingUrl)))
      .map(async (tab, n) => {
        const tour = welcome && n === 0;
        await chrome.tabs.create({ url: tour ? chrome.runtime.getURL("welcome/welcome.html") : "chrome://newtab/", windowId: tab.windowId, index: tab.index, active: tab.active });
        await chrome.tabs.remove(tab.id!);
      }),
  );
}

chrome.runtime.onInstalled.addListener((details) => {
  void traceStartup(`installed:${details.reason}`);
  void chrome.action.setBadgeBackgroundColor({ color: "#3b4ad0" });
  void chrome.action.setBadgeTextColor({ color: "#ffffff" });
  if (details.reason === "install" || details.reason === "update") {
    void seedDefaultShortcuts().catch(() => false);
  }
  if (details.reason === "install") {
    void chrome.storage.local.get("welcomeShown").then(({ welcomeShown }) => {
      void takeOverNewTabs(!welcomeShown);
      if (!welcomeShown) void chrome.storage.local.set({ welcomeShown: true });
    });
  }
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tabs once the browser has finished restoring them: the same count twice in a row. */
async function settledTabs(): Promise<chrome.tabs.Tab[]> {
  let tabs = await chrome.tabs.query({});
  for (let i = 0; i < 12; i++) {
    await sleep(250);
    const next = await chrome.tabs.query({});
    if (next.length === tabs.length && next.length > 0) return next;
    tabs = next;
  }
  return tabs;
}

/** Orbit for Android restores its tabs at every start and leaves Settings > On startup to this:
 * the chosen pages open once each, or a new tab page comes to front. */
async function openStartupPages(): Promise<void> {
  const startup = await browserStartup();
  void traceStartup(`mode:${startup ? `${startup.mode} ${startup.urls.length} urls` : "none"}`);
  if (!startup || startup.mode === "restore") return;
  const tabs: OpenTab[] = (await settledTabs()).flatMap((tab) => (tab.id === undefined ? [] : [{ id: tab.id, url: tab.url || tab.pendingUrl || "", incognito: tab.incognito }]));
  const steps = planStartup(startup, tabs, chrome.runtime.getURL("newtab/"));
  void traceStartup(`plan:${tabs.length} tabs, ${steps.length} steps`);
  for (const step of steps) {
    const done = step.open
      ? chrome.tabs.create({ url: step.open, active: step.active }).then((tab) => `opened ${tab.id}`)
      : step.activate !== undefined
        ? chrome.tabs.update(step.activate, { active: true }).then(() => `activated ${step.activate}`)
        : Promise.resolve("nothing");
    void traceStartup(await done.catch((error: unknown) => `failed: ${String(error)}`));
  }
}

/** The last browser starts as this worker saw them (events, windows open, pages opened), kept for
 * the Android check. */
let traceWrites: Promise<void> = Promise.resolve();
function traceStartup(event: string): Promise<void> {
  const at = Date.now();
  traceWrites = traceWrites.then(async () => {
    const { startupTrace } = await chrome.storage.local.get("startupTrace");
    const windows = (await chrome.windows.getAll()).length;
    const entries = Array.isArray(startupTrace) ? startupTrace : [];
    await chrome.storage.local.set({ startupTrace: [...entries, { at, event, windows }].slice(-30) });
  }).catch(() => undefined);
  return traceWrites;
}

/** Opens the startup pages once per browser session. */
async function startupPagesOnce(source: string): Promise<void> {
  const { startupPagesDone } = await chrome.storage.session.get("startupPagesDone");
  if (startupPagesDone) return;
  await chrome.storage.session.set({ startupPagesDone: true });
  void traceStartup(`pages:${source}`);
  await startupPagesWhenShown();
}

/** Android can start the browser without a window (for a download or a notification); the pages
 * then open with the first window. */
async function startupPagesWhenShown(): Promise<void> {
  if ((await chrome.windows.getAll()).length > 0) return openStartupPages();
  await chrome.storage.session.set({ startupPending: true });
}

chrome.windows.onCreated.addListener(() => {
  void chrome.storage.session.get("startupPending").then(async ({ startupPending }) => {
    if (!startupPending) return;
    await chrome.storage.session.remove("startupPending");
    void traceStartup("pages:first-window");
    await openStartupPages();
  });
});

// The browser re-registers an extension loaded from a folder at each launch, and may report that as
// either event, so the first worker run of a browser session does the startup work.
async function startOncePerSession(): Promise<void> {
  const { sessionStarted } = await chrome.storage.session.get("sessionStarted");
  if (sessionStarted) return;
  await chrome.storage.session.set({ sessionStarted: true });
  await replacePlaceholderTabs();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map((tab) => (tab.id === undefined ? undefined : syncAction(tab.id, tab.url ?? tab.pendingUrl))));
  await applyAll();
  await runStartupCleanup(await readPrivacy());
}

// Only a browser start, never an update or reload of this extension, opens the startup pages.
chrome.runtime.onStartup.addListener(() => {
  void traceStartup("onStartup");
  void chrome.runtime.getPlatformInfo().then(({ os }) => {
    if (os === "android") void startupPagesOnce("onStartup");
  });
});
void startOncePerSession();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) void checkForUpdate();
});
void scheduleUpdateCheck();
