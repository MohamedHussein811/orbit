// Dashboard preferences. Stored values are normalized on read, so bad data cannot break the page.
// Light and dark come from the browser's theme, set in Settings > Appearance.

import { PERIODS, type Period } from "./stats.ts";
import type { TemperatureUnit } from "./weather.ts";
import { DEFAULT_ITEM, GALLERY_CATEGORIES, GALLERY_MOTIONS, type GalleryCategory, type GalleryMotion } from "./gallery.ts";

/** Orbit Gallery (Orbit's own black hole video by default), an image or video the person chose, Orbit's plain surface, or a color. */
export const BACKGROUNDS = ["gallery", "custom", "plain", "color"] as const;
export type Background = (typeof BACKGROUNDS)[number];

/** Solid colors and gradients. All are dark enough for the light clock and text over them. */
export const COLORS = {
  graphite: "#1b1d22",
  midnight: "#0e1530",
  ocean: "#0b3a53",
  forest: "#123524",
  wine: "#3b1222",
  slate: "#2b3340",
  aurora: "linear-gradient(135deg, #0f2027, #203a43 50%, #2c5364)",
  nebula: "linear-gradient(135deg, #1a1033, #3a1c71 55%, #1f4f8b)",
  ember: "linear-gradient(135deg, #1f0f12, #6b1e2e 55%, #9a4423)",
  lagoon: "linear-gradient(135deg, #04293a, #064663 50%, #0b6e6a)",
  dusk: "linear-gradient(160deg, #141e30, #243b55)",
  orchid: "linear-gradient(135deg, #22092c, #872341 60%, #be3144)",
} as const;
export type ColorId = keyof typeof COLORS;
export const COLOR_IDS = Object.keys(COLORS) as ColorId[];

export const CLOCK_FORMATS = ["auto", "12", "24"] as const;
export type ClockFormat = (typeof CLOCK_FORMATS)[number];

/** Search engines offered in Customize. Choosing one also makes it the browser's search engine. "default" is a search engine Orbit does not list, chosen in Settings. */
export const SEARCH_ENGINES = {
  default: "",
  duckduckgo: "https://duckduckgo.com/?q=",
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  ecosia: "https://www.ecosia.org/search?q=",
  brave: "https://search.brave.com/search?q=",
  startpage: "https://www.startpage.com/do/search?query=",
} as const;
export type SearchEngine = keyof typeof SEARCH_ENGINES;
export const SEARCH_ENGINE_IDS = Object.keys(SEARCH_ENGINES) as SearchEngine[];

/** The browser's keyword for each listed engine (see orbit-behavior.patch). */
export const ENGINE_KEYWORDS: Record<Exclude<SearchEngine, "default">, string> = {
  duckduckgo: "duckduckgo.com",
  google: "google.com",
  bing: "bing.com",
  ecosia: "ecosia.org",
  brave: "search.brave.com",
  startpage: "startpage.com",
};

export function engineForKeyword(keyword: string | null): SearchEngine {
  const found = (Object.keys(ENGINE_KEYWORDS) as Array<Exclude<SearchEngine, "default">>).find((id) => ENGINE_KEYWORDS[id] === keyword);
  return found ?? "default";
}

/** Shortcuts the person keeps, or the sites they visit most. */
export const TOP_SITES_MODES = ["favorites", "frequent"] as const;
export type TopSitesMode = (typeof TOP_SITES_MODES)[number];

export const MAX_HIDDEN_SITES = 100;

export interface Settings {
  version: 1;
  background: Background;
  color: ColorId;
  galleryCategory: GalleryCategory | "all";
  /** "daily" for a new video each day, or the page of the chosen one. */
  galleryChoice: string;
  galleryMotion: GalleryMotion;
  videoPaused: boolean;
  showClock: boolean;
  clockFormat: ClockFormat;
  showDate: boolean;
  searchEngine: SearchEngine;
  topSitesMode: TopSitesMode;
  shortcutRows: 1 | 2;
  hiddenSites: string[];
  temperatureUnit: TemperatureUnit;
  statsPeriod: Period;
  bookmarksFolder: string | null;
}

export function defaultSettings(): Settings {
  return {
    version: 1,
    background: "gallery",
    color: "midnight",
    galleryCategory: "all",
    galleryChoice: DEFAULT_ITEM.page,
    galleryMotion: "video",
    videoPaused: false,
    showClock: true,
    clockFormat: "auto",
    showDate: true,
    searchEngine: "duckduckgo",
    topSitesMode: "favorites",
    shortcutRows: 1,
    hiddenSites: [],
    temperatureUnit: "celsius",
    statsPeriod: "7d",
    bookmarksFolder: null,
  };
}

const pick = <T extends string>(options: readonly T[], value: unknown, fallback: T): T => (options.includes(value as T) ? (value as T) : fallback);

export function sanitizeSettings(raw: unknown): Settings {
  const source = (raw ?? {}) as Partial<Record<keyof Settings, unknown>>;
  const defaults = defaultSettings();
  // Before 1.0.2 the black hole was its own "default" background. It is now Orbit Gallery's first video.
  const oldDefault = source.background === "default";
  return {
    version: 1,
    background: pick(BACKGROUNDS, source.background, defaults.background),
    color: pick(COLOR_IDS, source.color, defaults.color),
    galleryCategory: pick<GalleryCategory | "all">(["all", ...GALLERY_CATEGORIES], source.galleryCategory, defaults.galleryCategory),
    galleryChoice: oldDefault ? DEFAULT_ITEM.page : typeof source.galleryChoice === "string" && source.galleryChoice.length < 2048 ? source.galleryChoice : defaults.galleryChoice,
    galleryMotion: pick(GALLERY_MOTIONS, source.galleryMotion, defaults.galleryMotion),
    videoPaused: typeof source.videoPaused === "boolean" ? source.videoPaused : defaults.videoPaused,
    showClock: typeof source.showClock === "boolean" ? source.showClock : defaults.showClock,
    clockFormat: pick(CLOCK_FORMATS, source.clockFormat, defaults.clockFormat),
    showDate: typeof source.showDate === "boolean" ? source.showDate : defaults.showDate,
    searchEngine: pick(SEARCH_ENGINE_IDS, source.searchEngine, defaults.searchEngine),
    topSitesMode: pick(TOP_SITES_MODES, source.topSitesMode, defaults.topSitesMode),
    shortcutRows: source.shortcutRows === 2 ? 2 : 1,
    hiddenSites: Array.isArray(source.hiddenSites)
      ? [...new Set(source.hiddenSites.filter((url): url is string => typeof url === "string" && url.length < 2048))].slice(-MAX_HIDDEN_SITES)
      : [],
    temperatureUnit: source.temperatureUnit === "fahrenheit" ? "fahrenheit" : "celsius",
    statsPeriod: PERIODS.includes(source.statsPeriod as Period) ? (source.statsPeriod as Period) : defaults.statsPeriod,
    bookmarksFolder: typeof source.bookmarksFolder === "string" ? source.bookmarksFolder : null,
  };
}

/** Dark in a dark browser, Light in a light one. */
export function resolveTheme(prefersDark: boolean): "dark" | "light" {
  return prefersDark ? "dark" : "light";
}

/** The address for a search on the chosen engine, or null to use the browser's own engine. */
export function searchUrl(engine: SearchEngine, text: string): string | null {
  const base = SEARCH_ENGINES[engine];
  return base ? base + encodeURIComponent(text) : null;
}
