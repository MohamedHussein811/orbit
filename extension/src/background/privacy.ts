// Applies the choices on Orbit's privacy page to the browser.

import { excludeMatches, historyCutoff, removalOptions, sanitizePrivacy, type PrivacySettings } from "../shared/privacy.ts";

const SCRIPT_ID = "orbit-fingerprint";
const COSMETIC_ID = "orbit-cosmetic";
const YOUTUBE_ID = "orbit-youtube";
const PROMOS_ID = "orbit-promos";
const GOOGLE_PROMO_ID = "orbit-google-promo";
const YOUTUBE_MATCHES = ["*://youtube.com/*", "*://*.youtube.com/*", "*://*.youtube-nocookie.com/*"];

export async function readPrivacy(): Promise<PrivacySettings> {
  const { privacy } = await chrome.storage.local.get("privacy");
  return sanitizePrivacy(privacy);
}

export async function applyWebRtc(settings: PrivacySettings): Promise<void> {
  await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: settings.webrtc as chrome.privacy.IPHandlingPolicy });
}

/** Turns the threat lists on or off. */
export async function applyThreats(settings: PrivacySettings): Promise<void> {
  const enabled = await chrome.declarativeNetRequest.getEnabledRulesets();
  if (enabled.includes("threats") === settings.threats) return;
  await chrome.declarativeNetRequest.updateEnabledRulesets(settings.threats ? { enableRulesetIds: ["threats"] } : { disableRulesetIds: ["threats"] });
}

/** Sites in |hostsOff| have Shields off, so they get their real values. */
export async function applyFingerprinting(settings: PrivacySettings, hostsOff: readonly string[]): Promise<void> {
  await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {});
  if (settings.fingerprinting === "off") return;
  await chrome.scripting.registerContentScripts([
    {
      id: SCRIPT_ID,
      js: [`fingerprint/level-${settings.fingerprinting}.js`, "fingerprint/protect.js"],
      matches: ["http://*/*", "https://*/*"],
      excludeMatches: excludeMatches(hostsOff),
      allFrames: true,
      matchOriginAsFallback: true,
      runAt: "document_start",
      world: "MAIN",
    },
  ]);
}

/** Hides common ad elements everywhere except on sites with Shields off. */
export async function applyGenericHiding(hostsOff: readonly string[]): Promise<void> {
  await chrome.scripting.unregisterContentScripts({ ids: [COSMETIC_ID] }).catch(() => {});
  await chrome.scripting.registerContentScripts([
    {
      id: COSMETIC_ID,
      css: ["rules/cosmetic-generic.css"],
      matches: ["http://*/*", "https://*/*"],
      excludeMatches: excludeMatches(hostsOff),
      allFrames: true,
      runAt: "document_start",
    },
  ]);
}

/** YouTube ads and other browsers' promotions, which request blocking cannot reach. */
export async function applySiteFixes(hostsOff: readonly string[]): Promise<void> {
  await chrome.scripting.unregisterContentScripts({ ids: [YOUTUBE_ID, PROMOS_ID, GOOGLE_PROMO_ID] }).catch(() => {});
  await chrome.scripting.registerContentScripts([
    {
      id: YOUTUBE_ID,
      js: ["sites/youtube.js"],
      css: ["sites/youtube.css"],
      matches: YOUTUBE_MATCHES,
      excludeMatches: excludeMatches(hostsOff),
      allFrames: true,
      runAt: "document_start",
      world: "MAIN",
    },
    {
      id: PROMOS_ID,
      css: ["sites/promos.css"],
      matches: ["*://duckduckgo.com/*", "*://*.duckduckgo.com/*"],
      excludeMatches: excludeMatches(hostsOff),
      runAt: "document_start",
    },
    {
      id: GOOGLE_PROMO_ID,
      css: ["sites/google.css"],
      matches: ["http://*/*", "https://*/*"],
      excludeMatches: excludeMatches(hostsOff),
      runAt: "document_start",
    },
  ]);
}

const SCRIPTLET_PREFIX = "orbit-scriptlets-";

interface ScriptletIndex {
  shards: Array<{ name: string; hosts?: string[]; everywhere?: boolean }>;
}

function hostMatches(host: string): string[] {
  if (!/^[a-z0-9.-]+$/.test(host)) return [];
  return /^\d+(\.\d+){3}$/.test(host) ? [`*://${host}/*`] : [`*://*.${host}/*`];
}

/** Scriptlets from the filter lists, each shard only on the sites it names. */
export async function applyScriptlets(hostsOff: readonly string[]): Promise<void> {
  const registered = await chrome.scripting.getRegisteredContentScripts();
  const old = registered.map((script) => script.id).filter((id) => id.startsWith(SCRIPTLET_PREFIX));
  if (old.length) await chrome.scripting.unregisterContentScripts({ ids: old }).catch(() => {});
  let index: ScriptletIndex;
  try {
    index = (await (await fetch(chrome.runtime.getURL("rules/scriptlets/index.json"))).json()) as ScriptletIndex;
  } catch {
    return;
  }
  for (const shard of index.shards) {
    const matches = shard.everywhere ? ["http://*/*", "https://*/*"] : (shard.hosts ?? []).flatMap(hostMatches);
    if (matches.length === 0) continue;
    await chrome.scripting
      .registerContentScripts([
        {
          id: `${SCRIPTLET_PREFIX}${shard.name}`,
          js: [`rules/scriptlets/${shard.name}.js`],
          matches,
          excludeMatches: excludeMatches(hostsOff),
          allFrames: true,
          matchOriginAsFallback: true,
          runAt: "document_start",
          world: "MAIN",
        },
      ])
      .catch((error: unknown) => console.warn(`scriptlets ${shard.name}:`, error));
  }
}

/** Runs once each time Orbit starts. */
export async function runStartupCleanup(settings: PrivacySettings): Promise<void> {
  if (settings.clearOnStart.length > 0) {
    await chrome.browsingData.remove({ since: 0 }, removalOptions(settings.clearOnStart));
  }
  const cutoff = historyCutoff(settings.historyDays, Date.now());
  if (cutoff !== null) {
    await chrome.history.deleteRange({ startTime: 0, endTime: cutoff });
  }
}
