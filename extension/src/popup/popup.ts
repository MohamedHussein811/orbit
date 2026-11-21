// Shields popup: what was blocked on this page, and the switch for this site.

import { localizePage, t } from "../shared/i18n.ts";
import { siteOf, type BlockedHost, type Message, type TabState } from "../shared/shields.ts";
import type { Category } from "../shared/stats.ts";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggle = byId<HTMLInputElement>("switch");
const locale = chrome.i18n.getUILanguage();

const CATEGORY_NAME: Record<Category, string> = { ads: "ads", trackers: "trackers", threats: "threats" };

function showBlocked(blocked: Record<Category, BlockedHost[]>): void {
  const list = byId("blocked-list");
  const groups = (Object.keys(CATEGORY_NAME) as Category[]).filter((category) => blocked[category].length > 0);
  if (groups.length === 0) {
    const empty = document.createElement("p");
    empty.className = "blocked-empty";
    empty.textContent = t("nothingBlocked");
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(
    ...groups.map((category) => {
      const group = document.createElement("section");
      const heading = document.createElement("h2");
      heading.textContent = t(CATEGORY_NAME[category]);
      const rows = document.createElement("ul");
      for (const { host, count } of blocked[category]) {
        const row = document.createElement("li");
        const name = document.createElement("span");
        name.className = "blocked-host";
        name.dir = "ltr";
        name.textContent = host;
        name.title = host;
        const times = document.createElement("span");
        times.className = "blocked-count";
        times.textContent = count.toLocaleString(locale);
        row.append(name, times);
        rows.append(row);
      }
      group.append(heading, rows);
      return group;
    }),
  );
}

function showState(on: boolean): void {
  byId("switch-label").textContent = on ? t("shieldsOn") : t("shieldsOffForSite");
  document.body.classList.toggle("off", !on);
}

async function showCounts(tabId: number): Promise<TabState> {
  const request: Message = { type: "tab-state", tabId };
  const state = (await chrome.runtime.sendMessage(request)) as TabState;
  byId("ads").textContent = state.counts.ads.toLocaleString(locale);
  byId("trackers").textContent = state.counts.trackers.toLocaleString(locale);
  byId("threats").textContent = state.counts.threats.toLocaleString(locale);
  showBlocked(state.blocked);
  return state;
}

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const host = siteOf(tab.url);
  const tabId = tab.id;
  const state = await showCounts(tabId);
  // Keep counting while the popup stays open.
  chrome.storage.session.onChanged.addListener((changes) => {
    if (changes.tabCounts || changes.tabHosts) void showCounts(tabId);
  });

  byId("host").textContent = host ?? t("thisPage");
  if (!host) {
    toggle.disabled = true;
    toggle.checked = false;
    byId("switch-label").textContent = t("shieldsWebsitesOnly");
    document.body.classList.add("off");
    return;
  }
  const off = state.sitesOff.includes(host);
  toggle.checked = !off;
  showState(!off);
  toggle.addEventListener("change", async () => {
    const enabled = toggle.checked;
    const message: Message = { type: "set-shields", tabId, host, enabled, incognito: tab.incognito };
    toggle.disabled = true;
    showState(enabled);
    const reply = (await chrome.runtime.sendMessage(message).catch((error: Error) => ({ error: error.message }))) as { ok?: boolean; error?: string } | undefined;
    toggle.disabled = false;
    if (reply?.ok) return;
    toggle.checked = !enabled;
    showState(!enabled);
    byId("switch-label").textContent = t("shieldsSwitchFailed");
  });
}

document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
localizePage();

byId("privacy").addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

byId("siteSettings").addEventListener("click", () => {
  void chrome.tabs.create({ url: "chrome://settings/content" });
});

void main();
