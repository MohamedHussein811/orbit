// Release check: Orbit compares its browser version with the newest release on GitHub.

export const RELEASES = "https://github.com/MohamedHussein811/orbit/releases/";
export const LATEST_URL = `${RELEASES}latest/download/latest.json`;
export const CHECK_PERIOD_MINUTES = 24 * 60;

export interface Release {
  tag: string;
  browserVersion: string;
  url: string;
}

const VERSION = /^\d+(\.\d+){0,3}$/;

/** Compares dotted versions part by part; missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff) return Math.sign(diff);
  }
  return 0;
}

/** Accepts only a well-formed answer that points back to Orbit's own release pages. */
export function sanitizeRelease(raw: unknown): Release | null {
  const source = raw as Partial<Release> | null;
  if (!source || typeof source !== "object") return null;
  const { tag, browserVersion, url } = source;
  if (typeof tag !== "string" || !/^v\d+\.\d+\.\d+$/.test(tag)) return null;
  if (typeof browserVersion !== "string" || !VERSION.test(browserVersion)) return null;
  if (typeof url !== "string" || url !== `${RELEASES}tag/${tag}`) return null;
  return { tag, browserVersion, url };
}

/** A release is worth telling about when it carries a newer browser than the running one. */
export function isNewer(release: Release, runningVersion: string): boolean {
  return VERSION.test(runningVersion) && compareVersions(release.browserVersion, runningVersion) > 0;
}

interface Brand {
  brand: string;
  version: string;
}

/** The running browser's full version, from the browser's own brand list. */
export async function runningVersion(): Promise<string> {
  const data = (navigator as Navigator & { userAgentData?: { getHighEntropyValues(hints: string[]): Promise<{ fullVersionList?: Brand[] }> } }).userAgentData;
  const values = await data?.getHighEntropyValues(["fullVersionList"]);
  const brand = values?.fullVersionList?.find((entry) => /^(Orbit|Chromium)$/.test(entry.brand));
  return brand?.version ?? "";
}
