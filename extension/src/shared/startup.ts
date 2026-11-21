// What a phone opens when Orbit starts. Desktop Chromium applies Settings > On startup itself;
// Orbit for Android always restores its tabs, so this adds the chosen pages to them.

import type { StartupSettings } from "./search.ts";

export interface OpenTab {
  id: number;
  url: string;
  incognito?: boolean;
}

export interface StartupStep {
  /** A tab to bring to front instead of opening a new one. */
  activate?: number;
  /** A page to open. */
  open?: string;
  active: boolean;
}

const NEW_TAB = "chrome://newtab/";

/** Host without "www." plus path, so a page that redirected to https or www still counts as open. */
function pageKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return null;
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}${parsed.search}`;
  } catch {
    return null;
  }
}

const isNewTab = (url: string, newTabPage: string) => url === NEW_TAB || url.startsWith(newTabPage);

/** Steps that open each chosen page once, the first in front. Private tabs never count as open. */
export function planStartup(settings: StartupSettings, tabs: readonly OpenTab[], newTabPage: string): StartupStep[] {
  const regular = tabs.filter((tab) => !tab.incognito);
  if (settings.mode === "newTab") {
    const open = regular.find((tab) => isNewTab(tab.url, newTabPage));
    return [open ? { activate: open.id, active: true } : { open: NEW_TAB, active: true }];
  }
  if (settings.mode !== "pages") return [];
  const steps: StartupStep[] = [];
  const seen = new Set<string>();
  for (const url of settings.urls) {
    const key = pageKey(url);
    if (!key || seen.has(key)) continue;
    const first = seen.size === 0;
    seen.add(key);
    const open = regular.find((tab) => pageKey(tab.url) === key);
    if (!open) steps.push({ open: url, active: first });
    else if (first) steps.push({ activate: open.id, active: true });
  }
  return steps;
}
