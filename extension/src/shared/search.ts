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
