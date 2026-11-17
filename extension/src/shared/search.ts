// The browser's default search engine, read and set through chrome.search.getDefault and
// chrome.search.setDefault (orbit-search.patch). Other Chromium builds lack them, so each call
// reports null or false there and the page falls back to its own engine list.

interface OrbitSearchApi {
  getDefault?: (callback: (keyword: string) => void) => void;
  setDefault?: (keyword: string, callback: () => void) => void;
}

const api = () => chrome.search as unknown as OrbitSearchApi;

export function canSetBrowserEngine(): boolean {
  return typeof api().setDefault === "function";
}

/** The keyword of the browser's default engine, or null when it cannot be read. */
export function browserEngine(): Promise<string | null> {
  if (typeof api().getDefault !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      api().getDefault!((keyword) => resolve(chrome.runtime.lastError ? null : keyword || null));
    } catch {
      resolve(null);
    }
  });
}

/** Makes the engine with this keyword the browser's default. */
export function setBrowserEngine(keyword: string): Promise<boolean> {
  if (!canSetBrowserEngine()) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      api().setDefault!(keyword, () => resolve(!chrome.runtime.lastError));
    } catch {
      resolve(false);
    }
  });
}

// What opens when Orbit starts, read and set through chrome.search.getStartup and
// chrome.search.setStartup (orbit-search.patch).
export type StartupMode = "newTab" | "restore" | "pages";

export interface StartupSettings {
  mode: StartupMode;
  urls: string[];
  managed?: boolean;
}

interface OrbitStartupApi {
  getStartup?: (callback: (settings: StartupSettings) => void) => void;
  setStartup?: (settings: StartupSettings, callback: () => void) => void;
}

const startupApi = () => chrome.search as unknown as OrbitStartupApi;

/** What opens at start, or null when this browser cannot tell. */
export function browserStartup(): Promise<StartupSettings | null> {
  if (typeof startupApi().getStartup !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      startupApi().getStartup!((settings) => resolve(chrome.runtime.lastError || !settings ? null : settings));
    } catch {
      resolve(null);
    }
  });
}

export function setBrowserStartup(settings: StartupSettings): Promise<boolean> {
  if (typeof startupApi().setStartup !== "function") return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      startupApi().setStartup!({ mode: settings.mode, urls: settings.urls }, () => resolve(!chrome.runtime.lastError));
    } catch {
      resolve(false);
    }
  });
}

/** A web address typed by a person, made complete, or null when it is not one. */
export function startupUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname.includes(".")) return null;
    return url.href;
  } catch {
    return null;
  }
}
