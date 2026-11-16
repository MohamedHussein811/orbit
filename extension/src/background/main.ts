// Shields: counts what the browser's rule engine really blocked, and applies per-site switches.
// Daily totals are stored. Per-tab totals and the hosts blocked in each tab stay in memory (session
// storage) until the tab navigates or closes, so the Shields panel can list them. Full URLs never
// are kept.

import { addCount, emptyCounts, emptyStats, pruneStats, sanitizeStats, type Category, type Counts } from "../shared/stats.ts";
import { sanitizePrivacy } from "../shared/privacy.ts";
import { addBlockedHost, allowRule, blockedList, categoryOfMatch, emptyBlockedHosts, cosmeticCss, cosmeticShard, hostSuffixes, normalizeHosts, siteOf, type BlockedHosts, type Message, type SiteCosmetic, type TabState } from "../shared/shields.ts";
import { applyFingerprinting, applyGenericHiding, applySiteFixes, applyWebRtc, readPrivacy, runStartupCleanup } from "./privacy.ts";
import { checkForUpdate, scheduleUpdateCheck, UPDATE_ALARM } from "./updates.ts";

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

chrome.declarativeNetRequest.onRuleMatchedDebug.addListener(({ request, rule }) => {
  const category = categoryOfMatch(rule.rulesetId, rule.ruleId);
  if (!category) return;
  pending[category]++;
  if (request.tabId >= 0) {
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

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" && change.url) {
    void clearTab(tabId).then(() => showBadge(tabId, emptyCounts()));
    void hideOnSite(tabId, change.url);
  }
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
  if (hostSuffixes(host).some((suffix) => off.includes(suffix))) return;
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
  openedBy.delete(tabId);
  await chrome.tabs.remove(tabId).catch(() => {});
  pending.ads++;
  const counts = tabPending.get(opener.source) ?? emptyCounts();
  counts.ads++;
  tabPending.set(opener.source, counts);
  const blocked = tabHostsPending.get(opener.source) ?? emptyBlockedHosts();
  addBlockedHost(blocked, "ads", url);
  tabHostsPending.set(opener.source, blocked);
  flushTimer ??= setTimeout(flush, FLUSH_DELAY_MS);
}

chrome.webNavigation.onCreatedNavigationTarget.addListener(({ sourceTabId, tabId, url }) => {
  openedBy.set(tabId, { source: sourceTabId, at: Date.now() });
  void checkPopup(tabId, url);
});

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url && openedBy.has(tabId)) void checkPopup(tabId, change.url);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  openedBy.delete(tabId);
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
    await applyFingerprinting(await readPrivacy(), sitesOff);
    await applyGenericHiding(sitesOff);
    await applySiteFixes(sitesOff);
  }
}

async function continueToSite(host: string): Promise<void> {
  const { continuedSites } = await chrome.storage.session.get("continuedSites");
  const hosts = normalizeHosts([...normalizeHosts(continuedSites), host]);
  await chrome.storage.session.set({ continuedSites: hosts });
  await applySessionRule(SESSION_CONTINUE_RULE, hosts);
}

chrome.runtime.onMessage.addListener((message: Message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return false;
  handle(message).then(respond, (error: Error) => respond({ error: error.message }));
  return true;
});

async function handle(message: Message): Promise<unknown> {
  switch (message.type) {
    case "tab-state": {
      await flush();
      const [{ tabCounts, tabHosts }, regular, privateHosts] = await Promise.all([readStored(), hostsOff(), privateHostsOff()]);
      const hosts = tabHosts[message.tabId] ?? emptyBlockedHosts();
      const state: TabState = {
        counts: tabCounts[message.tabId] ?? emptyCounts(),
        blocked: { ads: blockedList(hosts.ads), trackers: blockedList(hosts.trackers), threats: blockedList(hosts.threats) },
        sitesOff: [...regular, ...privateHosts],
      };
      return state;
    }
    case "set-shields":
      await setShields(message.host, message.enabled, message.incognito);
      return { ok: true };
    case "continue-to-site":
      await continueToSite(message.host);
      return { ok: true };
    case "set-privacy": {
      const privacy = sanitizePrivacy(message.settings);
      await chrome.storage.local.set({ privacy });
      if (!privacy.checkUpdates) await chrome.storage.local.remove("update");
      await applyWebRtc(privacy);
      await applyFingerprinting(privacy, await hostsOff());
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
  const sitesOff = await hostsOff();
  await applyWebRtc(privacy);
  await applyFingerprinting(privacy, sitesOff);
  await applyGenericHiding(sitesOff);
  await applySiteFixes(sitesOff);
}

/** Tabs opened before this extension finished installing show Chromium's own new tab page.
 * A new tab in the same place shows Orbit's page instead. */
async function takeOverNewTabs(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  const chromiumNewTab = /^chrome:\/\/(newtab|new-tab-page)\//;
  await Promise.all(
    tabs
      .filter((tab) => tab.id !== undefined && (chromiumNewTab.test(tab.url ?? "") || chromiumNewTab.test(tab.pendingUrl ?? "")))
      .map(async (tab) => {
        await chrome.tabs.create({ url: "chrome://newtab/", windowId: tab.windowId, index: tab.index, active: tab.active });
        await chrome.tabs.remove(tab.id!);
      }),
  );
}

chrome.runtime.onInstalled.addListener((details) => {
  void chrome.action.setBadgeBackgroundColor({ color: "#3b4ad0" });
  void chrome.action.setBadgeTextColor({ color: "#ffffff" });
  if (details.reason === "install") void takeOverNewTabs();
});

// The browser re-registers an extension loaded from a folder at each launch, and may report that as
// either event, so the first worker run of a browser session does the startup work.
async function startOncePerSession(): Promise<void> {
  const { sessionStarted } = await chrome.storage.session.get("sessionStarted");
  if (sessionStarted) return;
  await chrome.storage.session.set({ sessionStarted: true });
  await applyAll();
  await runStartupCleanup(await readPrivacy());
}

chrome.runtime.onStartup.addListener(() => {});
void startOncePerSession();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === UPDATE_ALARM) void checkForUpdate();
});
void scheduleUpdateCheck();
