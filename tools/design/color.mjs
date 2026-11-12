// Color math for Orbit's design tokens: OKLCH to sRGB, CIELAB lightness and WCAG contrast.

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function hexToRgb(hex) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}

/** OKLCH to linear sRGB, unclamped. */
function oklchToLinear(l, c, h) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
}

export function rgbToOklch(rgb) {
  const [r, g, b] = rgb.map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

const inGamut = (rgb) => rgb.every((v) => v >= -1e-6 && v <= 1 + 1e-6);

/** OKLCH to 8-bit sRGB, lowering chroma until the color fits the sRGB gamut. */
export function oklchToRgb(l, c, h) {
  let chroma = c;
  let linear = oklchToLinear(l, chroma, h);
  while (!inGamut(linear) && chroma > 0) {
    chroma = Math.max(0, chroma - 0.002);
    linear = oklchToLinear(l, chroma, h);
  }
  return linear.map((v) => Math.round(fromLinear(Math.min(1, Math.max(0, v))) * 255));
}

export function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => toLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** CIELAB L*, the scale Material tones use. */
export function lstar(rgb) {
  const y = luminance(rgb);
  return y <= 216 / 24389 ? (y * 24389) / 27 : 116 * Math.cbrt(y) - 16;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The color of a hue and chroma whose CIELAB lightness is `target`. */
export function colorAtLstar(target, chroma, hue) {
  if (target <= 0) return [0, 0, 0];
  if (target >= 100) return [255, 255, 255];
  let lo = 0;
  let hi = 1;
  let rgb = [0, 0, 0];
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    rgb = oklchToRgb(mid, chroma, hue);
    if (lstar(rgb) < target) lo = mid;
    else hi = mid;
  }
  return rgb;
}
