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

const SHARD_COUNT = 64;

/** Must match cosmeticShard in tools/filter-compiler.mjs. */
export function cosmeticShard(host: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < host.length; i++) {
    value ^= host.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0) % SHARD_COUNT;
}

/** A site's rules also apply to its subdomains: a.b.example gets rules for b.example and example. */
export function hostSuffixes(host: string): string[] {
  const parts = host.split(".");
  const out: string[] = [];
  for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join("."));
  return out;
}

export interface SiteCosmetic {
  hide?: string[];
  show?: string[];
}

/** Stylesheet for one site. Selectors stay in separate rules so a rejected one affects nothing else. */
export function cosmeticCss(entries: readonly SiteCosmetic[]): string {
  const show = new Set(entries.flatMap((entry) => entry.show ?? []));
  const hide = entries.flatMap((entry) => entry.hide ?? []).filter((selector) => !show.has(selector));
  return [...hide.map((selector) => `${selector}{display:none!important}`), ...[...show].map((selector) => `${selector}{display:revert!important}`)].join("\n");
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
