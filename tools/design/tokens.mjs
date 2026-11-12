// Orbit's color tokens: the single source for the browser's native palette (Chromium's reference
// colors), the built-in pages' CSS and the contrast report in chromium/DESIGN.md.
//   node tools/design/tokens.mjs check     verify contrast and that generated files are current
//   node tools/design/tokens.mjs write     regenerate the files below
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { colorAtLstar, contrast, hexToRgb, rgbToHex, rgbToOklch } from "./color.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PALETTE_FILE = path.join(ROOT, "chromium/overlay/ui/color/orbit_palette.inc");
export const CSS_FILE = path.join(ROOT, "extension/src/shared/tokens.css");

export const ACCENT = "#8d9bff";
const ACCENT_HUE = rgbToOklch(hexToRgb(ACCENT))[2];

const SLOTS = {
  Primary: [0, 10, 20, 25, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100],
  Secondary: [0, 10, 12, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 90, 95, 99, 100],
  Tertiary: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100],
  Error: [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100],
  Neutral: [0, 4, 6, 8, 10, 12, 15, 17, 20, 22, 24, 25, 30, 40, 50, 60, 70, 80, 87, 90, 92, 94, 95, 96, 98, 99, 100],
  NeutralVariant: [0, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90, 95, 99, 100],
};

// Chromium's error ramp, kept as is: it is tuned for both modes and well tested.
const ERROR = {
  0: "#000000", 10: "#410e0b", 20: "#601410", 30: "#8c1d18", 40: "#b3261e", 50: "#dc362e",
  60: "#e46962", 70: "#ec928e", 80: "#f2b8b5", 90: "#f9dedc", 95: "#fceeee", 99: "#fffbf9", 100: "#ffffff",
};

const lerp = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));

/** Space sits darker than Material's nominal tones, so the frame reads as deep space. */
const spaceTone = (t) => (t <= 30 ? t * 0.5 : t < 60 ? lerp(15, 60, (t - 30) / 30) : t);
const nominal = (t) => t;
/** Brighter primary in dark mode, close to the logo's accent. */
const darkPrimaryTone = (t) => ({ 80: 72, 90: 86, 95: 93 })[t] ?? t;

const chromaByTone = (dark, light) => (t) => lerp(dark, light, (t - 20) / 75);

const RAMPS = {
  space: {
    Primary: { hue: ACCENT_HUE, chroma: () => 0.16, tone: darkPrimaryTone },
    Secondary: { hue: 255, chroma: () => 0.075, tone: nominal },
    Tertiary: { hue: 200, chroma: () => 0.09, tone: nominal },
    Neutral: { hue: 274, chroma: chromaByTone(0.05, 0.012), tone: spaceTone },
    NeutralVariant: { hue: 270, chroma: chromaByTone(0.06, 0.02), tone: spaceTone },
  },
  light: {
    Primary: { hue: ACCENT_HUE, chroma: () => 0.16, tone: nominal },
    Secondary: { hue: 255, chroma: () => 0.07, tone: nominal },
    Tertiary: { hue: 200, chroma: () => 0.08, tone: nominal },
    Neutral: { hue: 274, chroma: chromaByTone(0.035, 0.008), tone: nominal },
    NeutralVariant: { hue: 270, chroma: chromaByTone(0.045, 0.015), tone: nominal },
  },
};

export function buildPalette(mode) {
  const palette = {};
  for (const [ramp, tones] of Object.entries(SLOTS)) {
    palette[ramp] = {};
    for (const tone of tones) {
      if (ramp === "Error") {
        palette[ramp][tone] = ERROR[tone];
        continue;
      }
      const spec = RAMPS[mode][ramp];
      palette[ramp][tone] = rgbToHex(colorAtLstar(spec.tone(tone), spec.chroma(tone), spec.hue));
    }
  }
  return palette;
}

// Chromium's sys tokens for the default (baseline) palette, from ui/color/sys_color_mixer.cc.
const SYS = {
  surface: ["Neutral", 10, 100],
  onSurface: ["Neutral", 90, 10],
  onSurfaceVariant: ["NeutralVariant", 80, 30],
  onSurfaceSubtle: ["Neutral", 80, 30],
  outline: ["NeutralVariant", 60, 50],
  primary: ["Primary", 80, 40],
  onPrimary: ["Primary", 20, 100],
  primaryContainer: ["Primary", 30, 90],
  onPrimaryContainer: ["Primary", 90, 10],
  tonalContainer: ["Secondary", 30, null, "Primary", 90],
  onTonalContainer: ["Secondary", 90, null, "Primary", 10],
  error: ["Error", 80, 40],
  header: ["Neutral", 12, null, "Primary", 90],
  base: ["Neutral", 25, 100],
  omnibox: ["Neutral", 15, 94],
  containerHigh: ["Neutral", 17, 92],
  onHeaderPrimary: ["Primary", 80, 40],
};

export function sys(mode) {
  const palette = buildPalette(mode);
  const dark = mode === "space";
  const out = {};
  for (const [name, [ramp, darkTone, lightTone, lightRamp, lightRampTone]] of Object.entries(SYS)) {
    out[name] = dark ? palette[ramp][darkTone] : lightRamp ? palette[lightRamp][lightRampTone] : palette[ramp][lightTone];
  }
  return out;
}

// Pairs that must stay readable, with the WCAG AA minimum for each.
export const PAIRS = [
  ["onSurface", "surface", 4.5],
  ["onSurface", "header", 4.5],
  ["onSurface", "base", 4.5],
  ["onSurface", "omnibox", 4.5],
  ["onSurface", "containerHigh", 4.5],
  ["onSurfaceVariant", "surface", 4.5],
  ["onSurfaceVariant", "base", 4.5],
  ["onSurfaceSubtle", "omnibox", 4.5],
  ["primary", "surface", 4.5],
  ["primary", "base", 4.5],
  ["onHeaderPrimary", "header", 4.5],
  ["onPrimary", "primary", 4.5],
  ["onPrimaryContainer", "primaryContainer", 4.5],
  ["onTonalContainer", "tonalContainer", 4.5],
  ["error", "surface", 4.5],
  ["outline", "surface", 3],
  ["primary", "header", 3],
];

export function contrastReport() {
  const rows = [];
  for (const mode of ["space", "light"]) {
    const tokens = sys(mode);
    for (const [fg, bg, min] of PAIRS) {
      const ratio = contrast(hexToRgb(tokens[fg]), hexToRgb(tokens[bg]));
      rows.push({ mode, fg, bg, fgHex: tokens[fg], bgHex: tokens[bg], ratio, min, ok: ratio >= min });
    }
  }
  return rows;
}

function cppPalette() {
  const lines = [
    "// Generated by tools/design/tokens.mjs from Orbit's design tokens. Regenerate it instead of",
    "// editing it.",
    "",
    "void AddOrbitPalette(ColorProvider* provider,",
    "                     ColorProviderKey::ColorMode color_mode) {",
    "  ColorMixer& mixer = provider->AddMixer();",
    "  if (color_mode == ColorProviderKey::ColorMode::kDark) {",
  ];
  const emit = (mode) => {
    const palette = buildPalette(mode);
    for (const [ramp, tones] of Object.entries(palette)) {
      for (const [tone, hex] of Object.entries(tones)) {
        const [r, g, b] = hexToRgb(hex).map((v) => `0x${v.toString(16).padStart(2, "0").toUpperCase()}`);
        lines.push(`    mixer[kColorRef${ramp}${tone}] = {SkColorSetRGB(${r}, ${g}, ${b})};`);
      }
    }
  };
  emit("space");
  lines.push("  } else {");
  emit("light");
  lines.push("  }", "}", "");
  return lines.join("\n");
}

function cssTokens() {
  const block = (mode) => {
    const t = sys(mode);
    const p = buildPalette(mode);
    return [
      `  --orbit-surface: ${t.surface};`,
      `  --orbit-header: ${t.header};`,
      `  --orbit-base: ${t.base};`,
      `  --orbit-field: ${t.omnibox};`,
      `  --orbit-container-high: ${t.containerHigh};`,
      `  --orbit-on-surface: ${t.onSurface};`,
      `  --orbit-on-surface-variant: ${t.onSurfaceVariant};`,
      `  --orbit-outline: ${t.outline};`,
      `  --orbit-primary: ${t.primary};`,
      `  --orbit-on-primary: ${t.onPrimary};`,
      `  --orbit-primary-container: ${t.primaryContainer};`,
      `  --orbit-on-primary-container: ${t.onPrimaryContainer};`,
      `  --orbit-tertiary: ${mode === "space" ? p.Tertiary[80] : p.Tertiary[40]};`,
      `  --orbit-error: ${t.error};`,
      `  --orbit-deep: ${p.Neutral[4]};`,
    ].join("\n");
  };
  return [
    "/* Generated by tools/design/tokens.mjs from Orbit's design tokens. Regenerate it instead of",
    "   editing it. Space matches the browser's dark palette, Light its light palette. */",
    "",
    ":root,",
    ':root[data-theme="space"] {',
    block("space"),
    "}",
    "",
    ':root[data-theme="light"] {',
    block("light"),
    "}",
    "",
  ].join("\n");
}

export function generated() {
  return new Map([
    [PALETTE_FILE, cppPalette()],
    [CSS_FILE, cssTokens()],
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2] ?? "check";
  const report = contrastReport();
  for (const r of report) {
    console.log(`${r.ok ? "ok  " : "FAIL"} ${r.mode.padEnd(5)} ${r.fg} ${r.fgHex} on ${r.bg} ${r.bgHex}: ${r.ratio.toFixed(2)} (min ${r.min})`);
  }
  let failed = report.some((r) => !r.ok);
  for (const [file, content] of generated()) {
    if (command === "write") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      console.log(`wrote ${path.relative(ROOT, file)}`);
    } else if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) {
      console.log(`FAIL ${path.relative(ROOT, file)} is out of date, run: node tools/design/tokens.mjs write`);
      failed = true;
    }
  }
  if (failed) process.exit(1);
}
