// Shields popup: what was blocked on this page, and the switch for this site.

import { siteOf, type Message, type TabState } from "../shared/shields.ts";

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggle = byId<HTMLInputElement>("switch");

async function main(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const host = siteOf(tab.url);
  const request: Message = { type: "tab-state", tabId: tab.id };
  const state = (await chrome.runtime.sendMessage(request)) as TabState;

  byId("ads").textContent = state.counts.ads.toLocaleString();
  byId("trackers").textContent = state.counts.trackers.toLocaleString();
  byId("threats").textContent = state.counts.threats.toLocaleString();

  byId("host").textContent = host ?? "This page";
  if (!host) {
    toggle.disabled = true;
    toggle.checked = false;
    byId("switch-label").textContent = "Shields only apply to websites";
    return;
  }
  const off = state.sitesOff.includes(host);
  toggle.checked = !off;
  byId("switch-label").textContent = off ? "Shields off for this site" : "Shields on";
  toggle.addEventListener("change", async () => {
    const message: Message = { type: "set-shields", host, enabled: toggle.checked, incognito: tab.incognito };
    await chrome.runtime.sendMessage(message);
    byId("switch-label").textContent = toggle.checked ? "Shields on" : "Shields off for this site";
    await chrome.tabs.reload(tab.id!);
  });
}

byId("privacy").addEventListener("click", () => {
  void chrome.runtime.openOptionsPage();
});

byId("siteSettings").addEventListener("click", () => {
  void chrome.tabs.create({ url: "chrome://settings/content" });
});

void main();
