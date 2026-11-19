// Applies the choices on Orbit's privacy page to the browser.

import { excludeMatches, historyCutoff, removalOptions, sanitizePrivacy, type PrivacySettings } from "../shared/privacy.ts";
import { planScripts, type ScriptSpec } from "../shared/content-scripts.ts";

const SCRIPT_ID = "orbit-fingerprint";
const COSMETIC_ID = "orbit-cosmetic";
const YOUTUBE_ID = "orbit-youtube";
const PROMOS_ID = "orbit-promos";
const GOOGLE_PROMO_ID = "orbit-google-promo";
const YOUTUBE_MATCHES = ["*://youtube.com/*", "*://*.youtube.com/*", "*://*.youtube-nocookie.com/*"];
const SCRIPTLET_PREFIX = "orbit-scriptlets-";
const SCRIPTS_VERSION_KEY = "scriptsVersion";

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
function fingerprintScripts(settings: PrivacySettings, hostsOff: readonly string[]): ScriptSpec[] {
  if (settings.fingerprinting === "off") return [];
  return [
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
  ];
}

/** Hides common ad elements everywhere except on sites with Shields off. */
function genericHidingScripts(hostsOff: readonly string[]): ScriptSpec[] {
  return [
    {
      id: COSMETIC_ID,
      css: ["rules/cosmetic-generic.css"],
      matches: ["http://*/*", "https://*/*"],
      excludeMatches: excludeMatches(hostsOff),
      allFrames: true,
      runAt: "document_start",
    },
  ];
}

/** YouTube ads and other browsers' promotions, which request blocking cannot reach. */
function siteFixScripts(hostsOff: readonly string[]): ScriptSpec[] {
  return [
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
  ];
}

interface ScriptletIndex {
  shards: Array<{ name: string; hosts?: string[]; everywhere?: boolean }>;
}

let scriptletIndex: Promise<ScriptletIndex | null> | null = null;

function readScriptletIndex(): Promise<ScriptletIndex | null> {
  scriptletIndex ??= fetch(chrome.runtime.getURL("rules/scriptlets/index.json"))
    .then((response) => response.json() as Promise<ScriptletIndex>)
    .catch(() => null);
  return scriptletIndex;
}

function hostMatches(host: string): string[] {
  if (!/^[a-z0-9.-]+$/.test(host)) return [];
  return /^\d+(\.\d+){3}$/.test(host) ? [`*://${host}/*`] : [`*://*.${host}/*`];
}

/** Scriptlets from the filter lists, each shard only on the sites it names. */
async function scriptletScripts(hostsOff: readonly string[]): Promise<ScriptSpec[]> {
  const index = await readScriptletIndex();
  if (!index) return [];
  return index.shards.flatMap((shard) => {
    const matches = [...new Set(shard.everywhere ? ["http://*/*", "https://*/*"] : (shard.hosts ?? []).flatMap(hostMatches))];
    if (matches.length === 0) return [];
    return [
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
    ];
  });
}

async function registerScripts(scripts: ScriptSpec[]): Promise<void> {
  if (scripts.length === 0) return;
  const register = (batch: ScriptSpec[]) => chrome.scripting.registerContentScripts(batch as chrome.scripting.RegisteredContentScript[]);
  try {
    await register(scripts);
  } catch {
    // One bad script fails the whole batch, so the rest still get registered one by one.
    for (const script of scripts) await register([script]).catch((error: unknown) => console.warn(`content script ${script.id}:`, error));
  }
}

/** Fingerprinting protection, cosmetic filtering, site fixes and scriptlets, registered with the
 * browser. A new extension version registers everything again, since the files may have changed. */
export async function applyContentScripts(settings: PrivacySettings, hostsOff: readonly string[]): Promise<void> {
  const wanted = [...fingerprintScripts(settings, hostsOff), ...genericHidingScripts(hostsOff), ...siteFixScripts(hostsOff), ...(await scriptletScripts(hostsOff))];
  const version = chrome.runtime.getManifest().version;
  const [registered, stored] = await Promise.all([chrome.scripting.getRegisteredContentScripts(), chrome.storage.local.get(SCRIPTS_VERSION_KEY)]);
  const plan =
    stored[SCRIPTS_VERSION_KEY] === version
      ? planScripts(registered, wanted, () => true)
      : { unregister: registered.map((script) => script.id), update: [], register: wanted };
  if (plan.update.length) {
    try {
      await chrome.scripting.updateContentScripts(plan.update as chrome.scripting.RegisteredContentScript[]);
    } catch {
      const ids = new Set(plan.update.map((script) => script.id));
      plan.unregister.push(...ids);
      plan.register.push(...wanted.filter((script) => ids.has(script.id)));
    }
  }
  if (plan.unregister.length) await chrome.scripting.unregisterContentScripts({ ids: plan.unregister }).catch(() => {});
  await registerScripts(plan.register);
  if (stored[SCRIPTS_VERSION_KEY] !== version) await chrome.storage.local.set({ [SCRIPTS_VERSION_KEY]: version });
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
