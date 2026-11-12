// Dashboard preferences. Stored values are normalized on read, so bad data cannot break the page.
// Light and dark come from the browser's theme, set in Settings > Appearance.

import { PERIODS, type Period } from "./stats.ts";
import type { TemperatureUnit } from "./weather.ts";

/** Orbit's own background video, an image or video the person chose, or a plain color. */
export const BACKGROUNDS = ["default", "custom", "plain"] as const;
export type Background = (typeof BACKGROUNDS)[number];

export interface Settings {
  version: 1;
  background: Background;
  videoPaused: boolean;
  showClock: boolean;
  temperatureUnit: TemperatureUnit;
  statsPeriod: Period;
  bookmarksFolder: string | null;
}

export function defaultSettings(): Settings {
  return { version: 1, background: "default", videoPaused: false, showClock: true, temperatureUnit: "celsius", statsPeriod: "7d", bookmarksFolder: null };
}

export function sanitizeSettings(raw: unknown): Settings {
  const source = (raw ?? {}) as Partial<Settings>;
  const defaults = defaultSettings();
  return {
    version: 1,
    background: BACKGROUNDS.includes(source.background as Background) ? (source.background as Background) : defaults.background,
    videoPaused: typeof source.videoPaused === "boolean" ? source.videoPaused : defaults.videoPaused,
    showClock: typeof source.showClock === "boolean" ? source.showClock : defaults.showClock,
    temperatureUnit: source.temperatureUnit === "fahrenheit" ? "fahrenheit" : "celsius",
    statsPeriod: PERIODS.includes(source.statsPeriod as Period) ? (source.statsPeriod as Period) : defaults.statsPeriod,
    bookmarksFolder: typeof source.bookmarksFolder === "string" ? source.bookmarksFolder : null,
  };
}

/** Dark in a dark browser, Light in a light one. */
export function resolveTheme(prefersDark: boolean): "dark" | "light" {
  return prefersDark ? "dark" : "light";
}
