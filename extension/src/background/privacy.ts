// Applies the choices on Orbit's privacy page to the browser.

import { excludeMatches, historyCutoff, removalOptions, sanitizePrivacy, type PrivacySettings } from "../shared/privacy.ts";

const SCRIPT_ID = "orbit-fingerprint";

export async function readPrivacy(): Promise<PrivacySettings> {
  const { privacy } = await chrome.storage.local.get("privacy");
  return sanitizePrivacy(privacy);
}

export async function applyWebRtc(settings: PrivacySettings): Promise<void> {
  await chrome.privacy.network.webRTCIPHandlingPolicy.set({ value: settings.webrtc as chrome.privacy.IPHandlingPolicy });
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
