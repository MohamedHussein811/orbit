// Sharp icons for shortcuts. Imported bookmarks carry only 16 px icons, so the page asks each
// shortcut's own site, once, for its large icon (apple-touch-icon or the largest declared icon),
// without cookies. People can also choose their own image. Icons are stored per site.

const STORE = "siteIcons";
const SIZE = 96;
const MIN_SOURCE = 48;
const MAX_SITE_BYTES = 1_000_000;
const MAX_CUSTOM_BYTES = 10_000_000;
const TIMEOUT_MS = 6000;
const RETRY_MS = 14 * 86_400_000;
const MAX_ICONS = 400;

interface StoredIcon {
  src: string | null;
  custom: boolean;
  checked: number;
}

type IconStore = Record<string, StoredIcon>;

function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

async function readStore(): Promise<IconStore> {
  const { [STORE]: stored } = await chrome.storage.local.get(STORE);
  return stored && typeof stored === "object" ? (stored as IconStore) : {};
}

async function writeIcon(origin: string, icon: StoredIcon): Promise<void> {
  const store = await readStore();
  store[origin] = icon;
  const origins = Object.keys(store);
  if (origins.length > MAX_ICONS) {
    for (const old of origins.sort((a, b) => store[a]!.checked - store[b]!.checked).slice(0, origins.length - MAX_ICONS)) delete store[old];
  }
  await chrome.storage.local.set({ [STORE]: store });
}

/** Decodes any image the page can show, SVG included. */
async function decode(blob: Blob): Promise<ImageBitmap | null> {
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (bitmap) return bitmap;
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return await createImageBitmap(image, { resizeWidth: SIZE * 2, resizeHeight: Math.round((SIZE * 2 * (image.naturalHeight || 1)) / (image.naturalWidth || 1)) });
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Square PNG data URL of the image, or null if it is too small to look sharp. */
async function toIcon(blob: Blob, minimum: number, maxBytes: number): Promise<string | null> {
  if (blob.size > maxBytes) return null;
  const bitmap = await decode(blob);
  if (!bitmap) return null;
  if (Math.min(bitmap.width, bitmap.height) < minimum) {
    bitmap.close();
    return null;
  }
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const context = canvas.getContext("2d")!;
  const scale = Math.min(SIZE / bitmap.width, SIZE / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (SIZE - width) / 2, (SIZE - height) / 2, width, height);
  bitmap.close();
  const png = await canvas.convertToBlob({ type: "image/png" });
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(png);
  });
}

async function get(url: string): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", redirect: "follow", signal: controller.signal });
    return response.ok ? response : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Icon addresses the site declares, largest first, then the usual apple-touch-icon place. */
async function candidates(origin: string): Promise<string[]> {
  const found: Array<{ url: string; size: number }> = [];
  const page = await get(`${origin}/`);
  if (page && (page.headers.get("content-type") ?? "").includes("html")) {
    const html = (await page.text()).slice(0, 300_000);
    const doc = new DOMParser().parseFromString(html, "text/html");
    const base = page.url || `${origin}/`;
    for (const link of doc.querySelectorAll<HTMLLinkElement>("link[rel][href]")) {
      const rel = link.getAttribute("rel")!.toLowerCase();
      if (!/(^|\s)(icon|apple-touch-icon|apple-touch-icon-precomposed)(\s|$)/.test(rel)) continue;
      const sizes = (link.getAttribute("sizes") ?? "").toLowerCase();
      const size = sizes === "any" ? 512 : Math.max(0, ...sizes.split(/\s+/).map((item) => Number.parseInt(item, 10) || 0));
      const guess = size || (rel.includes("apple-touch-icon") ? 180 : 16);
      try {
        found.push({ url: new URL(link.getAttribute("href")!, base).href, size: guess });
      } catch {
        // A broken address is skipped.
      }
    }
  }
  found.sort((a, b) => b.size - a.size);
  const urls = found.filter((item) => item.size >= MIN_SOURCE && /^https?:/.test(item.url)).map((item) => item.url);
  urls.push(`${origin}/apple-touch-icon.png`);
  return [...new Set(urls)].slice(0, 5);
}

async function fetchSiteIcon(origin: string): Promise<string | null> {
  for (const url of await candidates(origin)) {
    const response = await get(url);
    if (!response) continue;
    const icon = await toIcon(await response.blob(), MIN_SOURCE, MAX_SITE_BYTES).catch(() => null);
    if (icon) return icon;
  }
  return null;
}

const inFlight = new Map<string, Promise<string | null>>();

/** The stored icon for this site, fetching it first when it was never tried or a try is old. */
export async function siteIcon(url: string): Promise<string | null> {
  const origin = originOf(url);
  if (!origin) return null;
  const stored = (await readStore())[origin];
  if (stored && (stored.src || stored.custom || Date.now() - stored.checked < RETRY_MS)) return stored.src;
  let pending = inFlight.get(origin);
  if (!pending) {
    pending = fetchSiteIcon(origin).then(async (src) => {
      await writeIcon(origin, { src, custom: false, checked: Date.now() });
      return src;
    });
    inFlight.set(origin, pending);
    void pending.finally(() => inFlight.delete(origin));
  }
  return pending;
}

/** The person's own image for this site. Returns false if the image cannot be used. */
export async function setCustomIcon(url: string, file: Blob): Promise<boolean> {
  const origin = originOf(url);
  if (!origin) return false;
  const src = await toIcon(file, 1, MAX_CUSTOM_BYTES).catch(() => null);
  if (!src) return false;
  await writeIcon(origin, { src, custom: true, checked: Date.now() });
  return true;
}

/** Goes back to the site's own icon. */
export async function resetIcon(url: string): Promise<void> {
  const origin = originOf(url);
  if (!origin) return;
  const store = await readStore();
  delete store[origin];
  await chrome.storage.local.set({ [STORE]: store });
}

export async function hasCustomIcon(url: string): Promise<boolean> {
  const origin = originOf(url);
  return origin ? Boolean((await readStore())[origin]?.custom) : false;
}
