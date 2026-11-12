// Shields popup: what was blocked on this page, and the switch for this site.

import { localizePage, t } from "../shared/i18n.ts";
import { siteOf, type Message, type TabState } from "../shared/shields.ts";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggle = byId<HTMLInputElement>("switch");
const locale = chrome.i18n.getUILanguage();

function showState(on: boolean): void {
  byId("switch-label").textContent = on ? t("shieldsOn") : t("shieldsOffForSite");
  document.body.classList.toggle("off", !on);
}

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const host = siteOf(tab.url);
  const request: Message = { type: "tab-state", tabId: tab.id };
  const state = (await chrome.runtime.sendMessage(request)) as TabState;

  byId("ads").textContent = state.counts.ads.toLocaleString(locale);
  byId("trackers").textContent = state.counts.trackers.toLocaleString(locale);
  byId("threats").textContent = state.counts.threats.toLocaleString(locale);

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
    const message: Message = { type: "set-shields", host, enabled: toggle.checked, incognito: tab.incognito };
    await chrome.runtime.sendMessage(message);
    showState(toggle.checked);
    await chrome.tabs.reload(tab.id!);
  });
}

document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: dark)").matches ? "space" : "light";
localizePage();

byId("privacy").addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

byId("siteSettings").addEventListener("click", () => {
  void chrome.tabs.create({ url: "chrome://settings/content" });
});

void main();
