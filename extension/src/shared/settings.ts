// Dashboard preferences. Stored values are normalized on read, so bad data cannot break the page.
// Light, dark and the accent color come from the browser's theme, set in Settings > Appearance.

import { PERIODS, type Period } from "./stats.ts";
import type { TemperatureUnit } from "./weather.ts";

/** The space scene behind the dashboard, or a plain background. A chosen image overrides both. */
export const BACKGROUNDS = ["scene", "plain"] as const;
export type Background = (typeof BACKGROUNDS)[number];

export interface Settings {
  version: 1;
  background: Background;
  temperatureUnit: TemperatureUnit;
  statsPeriod: Period;
  bookmarksFolder: string | null;
}

export function defaultSettings(): Settings {
  return { version: 1, background: "scene", temperatureUnit: "celsius", statsPeriod: "7d", bookmarksFolder: null };
}

export function sanitizeSettings(raw: unknown): Settings {
  const source = (raw ?? {}) as Partial<Settings>;
  const defaults = defaultSettings();
  return {
    version: 1,
    background: BACKGROUNDS.includes(source.background as Background) ? (source.background as Background) : defaults.background,
    temperatureUnit: source.temperatureUnit === "fahrenheit" ? "fahrenheit" : "celsius",
    statsPeriod: PERIODS.includes(source.statsPeriod as Period) ? (source.statsPeriod as Period) : defaults.statsPeriod,
    bookmarksFolder: typeof source.bookmarksFolder === "string" ? source.bookmarksFolder : null,
  };
}

/** Space in a dark browser, Light in a light one. */
export function resolveTheme(prefersDark: boolean): "space" | "light" {
  return prefersDark ? "space" : "light";
}
