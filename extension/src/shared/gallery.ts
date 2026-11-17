// Orbit Gallery: HD videos by category from Pixabay (see tools/gallery.mjs), plus Orbit's own
// space videos. People pick a category or all of them, either one video or a new one each day, and
// whether it plays or shows as a still picture.

export const GALLERY_CATEGORIES = ["summer", "animals", "space", "travel", "love", "sport", "people", "city", "things", "nature", "christmas", "abstractions"] as const;
export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];

export const GALLERY_MOTIONS = ["video", "still"] as const;
export type GalleryMotion = (typeof GALLERY_MOTIONS)[number];

export interface GalleryItem {
  /** Stable key: the video's page on Pixabay, or the source page of Orbit's own video. */
  page: string;
  title: string;
  /** The still frame, or the picture for items without a video. */
  poster: string;
  video?: string;
  /** Seconds of the video that play, for videos with a title card or a closing logo. */
  start?: number;
  end?: number;
  author: string;
  license: string;
  licenseUrl: string;
  /** Ships inside the browser, so nothing is downloaded. */
  local?: boolean;
}

export interface Gallery {
  categories: Partial<Record<GalleryCategory, GalleryItem[]>>;
}

/** The new tab page's default video. */
export const DEFAULT_ITEM: GalleryItem = {
  page: "https://pixabay.com/videos/space-universe-astronomy-cosmos-175323/",
  title: "Black hole",
  poster: "media/space.jpg",
  video: "media/space.webm",
  author: "Pixabay",
  license: "Pixabay Content License",
  licenseUrl: "https://pixabay.com/service/license-summary/",
  local: true,
};

export const NASA_BLACK_HOLE: GalleryItem = {
  page: "https://svs.gsfc.nasa.gov/13326/",
  title: "Black hole accretion disk",
  poster: "media/blackhole.jpg",
  video: "media/blackhole.webm",
  author: "NASA's Goddard Space Flight Center/Jeremy Schnittman",
  license: "Public domain",
  licenseUrl: "",
  local: true,
};

const POSTER = /^https:\/\/cdn\.pixabay\.com\/video\/[\w/-]+_(large|medium|small)\.jpg$/;
const VIDEO = /^https:\/\/cdn\.pixabay\.com\/video\/[\w/-]+\.mp4$/;

const MAX_CLIP_SECONDS = 3600;

function clipRange(start: unknown, end: unknown): { start?: number; end?: number } {
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= MAX_CLIP_SECONDS;
  if (!valid(start) || !valid(end) || end - start < 3) return {};
  return { start, end };
}

export function sanitizeGallery(raw: unknown): Gallery {
  const categories: Partial<Record<GalleryCategory, GalleryItem[]>> = {};
  const source = ((raw as { categories?: unknown } | null)?.categories ?? {}) as Record<string, unknown>;
  for (const id of GALLERY_CATEGORIES) {
    const list = Array.isArray(source[id]) ? (source[id] as Array<Partial<GalleryItem>>) : [];
    categories[id] = list
      .filter((item) => typeof item?.poster === "string" && POSTER.test(item.poster) && typeof item.page === "string" && typeof item.author === "string")
      .filter((item) => item.video === undefined || (typeof item.video === "string" && VIDEO.test(item.video)))
      .map((item) => ({
        page: item.page!,
        title: String(item.title ?? ""),
        poster: item.poster!,
        ...(item.video ? { video: item.video } : {}),
        ...clipRange(item.start, item.end),
        author: item.author!,
        license: String(item.license ?? ""),
        licenseUrl: String(item.licenseUrl ?? ""),
      }));
  }
  categories.space = [DEFAULT_ITEM, NASA_BLACK_HOLE, ...(categories.space ?? [])];
  return { categories };
}

export function itemsIn(gallery: Gallery, category: GalleryCategory | "all"): GalleryItem[] {
  if (category !== "all") return gallery.categories[category] ?? [];
  return GALLERY_CATEGORIES.flatMap((id) => gallery.categories[id] ?? []);
}

/** The local calendar day, so the daily video changes at midnight. */
export function dayOf(time: number): string {
  const date = new Date(time);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** The chosen item, or today's item from the category when the choice is "daily". */
export function currentItem(gallery: Gallery, category: GalleryCategory | "all", choice: string, now: number): GalleryItem | null {
  const list = itemsIn(gallery, category);
  if (list.length === 0) return null;
  if (choice !== "daily") {
    const chosen = itemsIn(gallery, "all").find((item) => item.page === choice);
    if (chosen) return chosen;
  }
  return list[hash(`${dayOf(now)}|${category}`) % list.length]!;
}

/** A smaller copy of the still frame for the picker. */
export function thumbnailOf(item: GalleryItem): string {
  return item.local ? item.poster : item.poster.replace(/_(large|medium|small)\.jpg$/, "_tiny.jpg");
}

/**
 * Whether this item plays: it has a video the browser can decode and the person wants motion.
 * Pixabay's videos are H.264, which Orbit for Linux does not decode; there they show as stills.
 */
export function playsVideo(item: GalleryItem, motion: GalleryMotion, playsMp4 = true): item is GalleryItem & { video: string } {
  if (!item.video || motion !== "video") return false;
  return playsMp4 || !item.video.endsWith(".mp4");
}

/** The media type of a gallery file, since Pixabay's CDN serves them untyped. */
export function mediaTypeOf(url: string): string {
  if (url.endsWith(".mp4")) return "video/mp4";
  if (url.endsWith(".jpg")) return "image/jpeg";
  return "";
}
