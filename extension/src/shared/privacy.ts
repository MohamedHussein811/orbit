// Privacy choices, normalized on read so bad data falls back to the protective default.

export const FINGERPRINT_LEVELS = ["off", "standard", "strict"] as const;
export type FingerprintLevel = (typeof FINGERPRINT_LEVELS)[number];

export const WEBRTC_POLICIES = ["default_public_interface_only", "disable_non_proxied_udp", "default"] as const;
export type WebRtcPolicy = (typeof WEBRTC_POLICIES)[number];

export const CLEARABLE_DATA = ["cookies", "cache", "history", "downloads", "formData"] as const;
export type ClearableData = (typeof CLEARABLE_DATA)[number];

/** Allowed values for automatic history cleanup, in days. Zero keeps history until it is deleted by hand. */
export const HISTORY_DAYS = [0, 7, 30, 90, 365] as const;

export interface PrivacySettings {
  version: 1;
  fingerprinting: FingerprintLevel;
  webrtc: WebRtcPolicy;
  clearOnStart: ClearableData[];
  historyDays: number;
  checkUpdates: boolean;
}

export function defaultPrivacy(): PrivacySettings {
  return { version: 1, fingerprinting: "standard", webrtc: "default_public_interface_only", clearOnStart: [], historyDays: 0, checkUpdates: true };
}

export function sanitizePrivacy(raw: unknown): PrivacySettings {
  const source = (raw ?? {}) as Partial<PrivacySettings>;
  const defaults = defaultPrivacy();
  const clear = Array.isArray(source.clearOnStart) ? source.clearOnStart.filter((item) => CLEARABLE_DATA.includes(item)) : [];
  return {
    version: 1,
    fingerprinting: FINGERPRINT_LEVELS.includes(source.fingerprinting as FingerprintLevel) ? (source.fingerprinting as FingerprintLevel) : defaults.fingerprinting,
    webrtc: WEBRTC_POLICIES.includes(source.webrtc as WebRtcPolicy) ? (source.webrtc as WebRtcPolicy) : defaults.webrtc,
    clearOnStart: [...new Set(clear)],
    historyDays: (HISTORY_DAYS as readonly number[]).includes(source.historyDays as number) ? (source.historyDays as number) : 0,
    checkUpdates: source.checkUpdates !== false,
  };
}

/** The options object for chrome.browsingData.remove. */
export function removalOptions(clear: readonly ClearableData[]): Record<string, boolean> {
  const options: Record<string, boolean> = {};
  for (const item of clear) {
    if (item === "cookies") {
      options.cookies = true;
      options.localStorage = true;
      options.indexedDB = true;
      options.serviceWorkers = true;
      options.cacheStorage = true;
      options.webSQL = true;
      options.fileSystems = true;
    } else {
      options[item] = true;
    }
  }
  return options;
}

export function historyCutoff(days: number, now: number): number | null {
  return days > 0 ? now - days * 86_400_000 : null;
}

/** Sites with Shields off keep their real values, so a site broken by protection can be fixed in one switch. */
export function excludeMatches(hosts: readonly string[]): string[] {
  return hosts.flatMap((host) => [`*://${host}/*`, `*://*.${host}/*`]);
}
