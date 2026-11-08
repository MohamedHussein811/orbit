// Shields: counts what the browser's rule engine really blocked, and applies per-site switches.
// Only daily totals and per-tab totals are stored. URLs and hostnames of blocked requests never are.

import { addCount, emptyCounts, emptyStats, pruneStats, sanitizeStats, type Category, type Counts } from "../shared/stats.ts";
import { allowRule, categoryOfMatch, normalizeHosts, type Message, type TabState } from "../shared/shields.ts";

const FLUSH_DELAY_MS = 500;
const DYNAMIC_ALLOW_RULE = 1;
const SESSION_PRIVATE_RULE = 1;
const SESSION_CONTINUE_RULE = 2;

let pending: Counts = emptyCounts();
const tabPending = new Map<number, Counts>();
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
  }
  flushTimer ??= setTimeout(flush, FLUSH_DELAY_MS);
});

function flush(): Promise<void> {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  const daily = pending;
  const byTab = new Map(tabPending);
  pending = emptyCounts();
  tabPending.clear();
  return serialized(async () => {
    const now = Date.now();
    const { stats, tabCounts } = await readStored();
    for (const category of Object.keys(daily) as Category[]) {
      if (daily[category] > 0) addCount(stats, category, daily[category], now);
    }
    pruneStats(stats, now);
    await chrome.storage.local.set({ stats });
    for (const [tabId, counts] of byTab) {
      const total = (tabCounts[tabId] ??= emptyCounts());
      for (const category of Object.keys(counts) as Category[]) total[category] += counts[category];
    }
    await chrome.storage.session.set({ tabCounts });
    await Promise.all([...byTab.keys()].map((tabId) => showBadge(tabId, tabCounts[tabId]!)));
  });
}

async function readStored(): Promise<{ stats: ReturnType<typeof sanitizeStats>; tabCounts: Record<number, Counts> }> {
  const [{ stats }, { tabCounts }] = await Promise.all([chrome.storage.local.get("stats"), chrome.storage.session.get("tabCounts")]);
  return { stats: sanitizeStats(stats), tabCounts: (tabCounts as Record<number, Counts> | undefined) ?? {} };
}

function showBadge(tabId: number, counts: Counts): Promise<void> {
  const total = counts.ads + counts.trackers + counts.threats;
  const text = total === 0 ? "" : total > 999 ? "999+" : String(total);
  return chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

function clearTab(tabId: number): Promise<void> {
  tabPending.delete(tabId);
  return serialized(async () => {
    const { tabCounts } = await readStored();
    if (tabCounts[tabId]) {
      delete tabCounts[tabId];
      await chrome.storage.session.set({ tabCounts });
    }
  });
}

chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" && change.url) {
    void clearTab(tabId).then(() => showBadge(tabId, emptyCounts()));
  }
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
      const [{ tabCounts }, regular, privateHosts] = await Promise.all([readStored(), hostsOff(), privateHostsOff()]);
      const state: TabState = { counts: tabCounts[message.tabId] ?? emptyCounts(), sitesOff: [...regular, ...privateHosts] };
      return state;
    }
    case "set-shields":
      await setShields(message.host, message.enabled, message.incognito);
      return { ok: true };
    case "continue-to-site":
      await continueToSite(message.host);
      return { ok: true };
    case "reset-stats":
      await flush();
      await serialized(() => chrome.storage.local.set({ stats: emptyStats() }));
      return { ok: true };
    default:
      throw new Error("unknown message");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.action.setBadgeBackgroundColor({ color: "#3b4ad0" });
  void chrome.action.setBadgeTextColor({ color: "#ffffff" });
});
