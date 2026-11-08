// Shared facts about blocking, used by the background worker and its tests.

import type { PrivacySettings } from "./privacy.ts";
import type { Category } from "./stats.ts";

/** Compiled allow rules start at this ID (see tools/filter-compiler.mjs). They do not count as blocks. */
export const ALLOW_ID_BASE = 1_000_000;

const RULESET_CATEGORY: Record<string, Category> = { ads: "ads", trackers: "trackers", threats: "threats" };

/** Returns what a matched rule counts as, or null if it blocked nothing. */
export function categoryOfMatch(rulesetId: string, ruleId: number): Category | null {
  if (ruleId >= ALLOW_ID_BASE) return null;
  return RULESET_CATEGORY[rulesetId] ?? null;
}

/** The host a per-site switch applies to. Only web pages have one. */
export function siteOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function normalizeHosts(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const hosts = raw.filter((host): host is string => typeof host === "string" && /^[a-z0-9.-]+$/i.test(host)).map((host) => host.toLowerCase());
  return [...new Set(hosts)].sort();
}

/** One rule that switches blocking off for the listed hosts, including everything their pages load. */
export function allowRule(id: number, hosts: readonly string[]): chrome.declarativeNetRequest.Rule {
  return {
    id,
    priority: 100,
    action: { type: "allowAllRequests" as chrome.declarativeNetRequest.RuleActionType },
    condition: {
      requestDomains: [...hosts],
      resourceTypes: ["main_frame", "sub_frame"] as chrome.declarativeNetRequest.ResourceType[],
    },
  };
}

export type Message =
  | { type: "tab-state"; tabId: number }
  | { type: "set-shields"; host: string; enabled: boolean; incognito: boolean }
  | { type: "continue-to-site"; host: string }
  | { type: "reset-stats" }
  | { type: "set-privacy"; settings: PrivacySettings };

export interface TabState {
  counts: Record<Category, number>;
  sitesOff: string[];
}
