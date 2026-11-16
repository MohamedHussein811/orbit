// Orbit Gallery: videos by category from Wikimedia Commons (see tools/gallery.mjs), plus Orbit's own
// space videos. People pick a category or all of them, either one video or a new one each day, and
// whether it plays or shows as a still picture.

export const GALLERY_CATEGORIES = ["summer", "animals", "space", "travel", "love", "sport", "people", "city", "things", "nature", "christmas", "abstractions"] as const;
export type GalleryCategory = (typeof GALLERY_CATEGORIES)[number];

export const GALLERY_MOTIONS = ["video", "still"] as const;
export type GalleryMotion = (typeof GALLERY_MOTIONS)[number];

export interface GalleryItem {
  /** Stable key: the file's page on Wikimedia Commons, or the source page of Orbit's own video. */
  page: string;
  title: string;
  /** The still frame, or the picture for items without a video. */
  poster: string;
  video?: string;
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

const POSTER = /^https:\/\/(upload|thumb)\.wikimedia\.org\//;
const VIDEO = /^https:\/\/upload\.wikimedia\.org\/.+\.webm$/;

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

/** A smaller copy of the still frame for the picker, in one of Wikimedia's standard widths. */
export function thumbnailOf(item: GalleryItem, width: 250 | 330 | 500 | 960 = 500): string {
  return item.local ? item.poster : item.poster.replace(/\/\d+px-([^/]+)$/, `/${width}px-$1`);
}

/** Whether this item plays: it has a video and the person wants motion. */
export function playsVideo(item: GalleryItem, motion: GalleryMotion): item is GalleryItem & { video: string } {
  return Boolean(item.video) && motion === "video";
}
