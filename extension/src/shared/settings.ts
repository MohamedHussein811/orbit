// Dashboard preferences. Stored values are normalized on read, so bad data cannot break the page.

import { PERIODS, type Period } from "./stats.ts";
import type { TemperatureUnit } from "./weather.ts";

export const THEME_MODES = ["system", "light", "dark", "space"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

/** Offered accents. Any valid hex color also works, through the color picker. */
export const ACCENTS = ["#8d9bff", "#b497ff", "#5fd4c8", "#f2b75b", "#f28ca8", "#c9cedb"] as const;
export const DEFAULT_ACCENT = ACCENTS[0];

export interface Settings {
  version: 1;
  theme: ThemeMode;
  accent: string;
  temperatureUnit: TemperatureUnit;
  statsPeriod: Period;
  bookmarksFolder: string | null;
}

export function defaultSettings(): Settings {
  return { version: 1, theme: "space", accent: DEFAULT_ACCENT, temperatureUnit: "celsius", statsPeriod: "7d", bookmarksFolder: null };
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function sanitizeSettings(raw: unknown): Settings {
  const source = (raw ?? {}) as Partial<Settings>;
  const defaults = defaultSettings();
  return {
    version: 1,
    theme: THEME_MODES.includes(source.theme as ThemeMode) ? (source.theme as ThemeMode) : defaults.theme,
    accent: typeof source.accent === "string" && HEX_COLOR.test(source.accent) ? source.accent.toLowerCase() : defaults.accent,
    temperatureUnit: source.temperatureUnit === "fahrenheit" ? "fahrenheit" : "celsius",
    statsPeriod: PERIODS.includes(source.statsPeriod as Period) ? (source.statsPeriod as Period) : defaults.statsPeriod,
    bookmarksFolder: typeof source.bookmarksFolder === "string" ? source.bookmarksFolder : null,
  };
}

/** The theme a page actually renders, once "system" is resolved. */
export function resolveTheme(mode: ThemeMode, prefersDark: boolean): "light" | "dark" | "space" {
  if (mode === "system") return prefersDark ? "dark" : "light";
  return mode;
}
