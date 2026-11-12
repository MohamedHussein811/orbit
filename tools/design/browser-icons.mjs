// Orbit's icons for the browser frame: toolbar buttons, tab close and new tab. Each icon is drawn
// once here as SVG-style shapes and written as a Chromium .icon file into the overlay, replacing
// the file Chromium 157's toolbar uses. Lines have round caps; corners are separate segments so
// the round caps overlap into round joins (Chromium strokes with mitered joins).
//   node tools/design/browser-icons.mjs write              write the overlay .icon files
//   node tools/design/browser-icons.mjs preview <out.svg>  contact sheet on toolbar colors
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OVERLAY = path.join(ROOT, "chromium", "overlay");

const line = (d, width = 1.5) => ({ kind: "path", d, width });
const dot = (cx, cy, r) => ({ kind: "circle", cx, cy, r });
const ring = (cx, cy, r, width = 1.5) => ({ kind: "circle", cx, cy, r, width });
const round = (n) => Math.round(n * 100) / 100;

/** Reload: an open ring with its gap at the top right, like Orbit's mark, and an arrowhead. */
function reloadShapes() {
  const cx = 10;
  const cy = 10;
  const r = 5.75;
  const start = (12 * Math.PI) / 180;
  const end = (72 * Math.PI) / 180;
  const at = (a) => [round(cx + r * Math.cos(a)), round(cy - r * Math.sin(a))];
  const [sx, sy] = at(start);
  const [ex, ey] = at(end);
  // Travel is clockwise, so at the end the arrow points along (sin a, cos a).
  const dir = [Math.sin(end), Math.cos(end)];
  const barb = (deg) => {
    const t = (deg * Math.PI) / 180;
    const bx = -dir[0] * Math.cos(t) + dir[1] * Math.sin(t);
    const by = -dir[0] * Math.sin(t) - dir[1] * Math.cos(t);
    return [round(ex + 2.6 * bx), round(ey + 2.6 * by)];
  };
  const [ax, ay] = barb(42);
  const [bx, by] = barb(-42);
  return [
    line(`M${sx} ${sy} A${r} ${r} 0 1 1 ${ex} ${ey}`),
    line(`M${ex} ${ey} L${ax} ${ay}`),
    line(`M${ex} ${ey} L${bx} ${by}`),
  ];
}

export const ICONS = [
  {
    name: "back",
    canvas: 20,
    targets: ["components/vector_icons/back_arrow_chrome_refresh_old.icon"],
    shapes: [line("M12.25 4.5 L6.75 10"), line("M6.75 10 L12.25 15.5")],
  },
  {
    name: "forward",
    canvas: 20,
    targets: ["components/vector_icons/forward_arrow_chrome_refresh_old.icon"],
    shapes: [line("M7.75 4.5 L13.25 10"), line("M13.25 10 L7.75 15.5")],
  },
  {
    name: "reload",
    canvas: 20,
    targets: ["components/vector_icons/reload_chrome_refresh_old.icon"],
    shapes: reloadShapes(),
  },
  {
    name: "stop",
    canvas: 20,
    targets: ["chrome/app/vector_icons/navigate_stop_chrome_refresh_old.icon"],
    shapes: [line("M5.5 5.5 L14.5 14.5"), line("M14.5 5.5 L5.5 14.5")],
  },
  {
    name: "home",
    canvas: 20,
    targets: ["chrome/app/vector_icons/navigate_home_chrome_refresh_old.icon"],
    shapes: [
      line("M3.75 9.5 L10 4"),
      line("M10 4 L16.25 9.5"),
      line("M5.75 8.25 V14.25 Q5.75 16 7.5 16 H12.5 Q14.25 16 14.25 14.25 V8.25"),
      line("M8.5 16 V13 A1.5 1.5 0 0 1 11.5 13 V16"),
    ],
  },
  {
    name: "menu",
    canvas: 20,
    targets: ["chrome/app/vector_icons/browser_tools_chrome_refresh_old.icon"],
    shapes: [dot(4.75, 10, 1.4), dot(10, 10, 1.4), dot(15.25, 10, 1.4)],
  },
  {
    name: "download",
    canvas: 20,
    targets: ["chrome/app/vector_icons/download_toolbar_button_chrome_refresh_old.icon"],
    shapes: [line("M10 4 V12.75"), line("M6.5 9.25 L10 12.75"), line("M10 12.75 L13.5 9.25"), line("M4.75 16 H15.25")],
  },
  {
    name: "extensions",
    canvas: 20,
    targets: ["components/vector_icons/extension_chrome_refresh_old.icon"],
    shapes: [
      line(
        "M6.3 15.6 A1.5 1.5 0 0 1 4.8 14.1 V12.55 A1.6 1.6 0 1 0 4.8 9.95 V8.6 A1.5 1.5 0 0 1 6.3 7.1 H7.7 A1.6 1.6 0 1 1 10.3 7.1 H11.7 A1.5 1.5 0 0 1 13.2 8.6 V9.95 A1.6 1.6 0 1 1 13.2 12.55 V14.1 A1.5 1.5 0 0 1 11.7 15.6 Z",
      ),
    ],
  },
  {
    name: "tab-close",
    canvas: 16,
    targets: ["chrome/app/vector_icons/close_tab_chrome_refresh_old.icon"],
    shapes: [line("M5.25 5.25 L10.75 10.75", 1.4), line("M10.75 5.25 L5.25 10.75", 1.4)],
  },
  {
    name: "new-tab",
    canvas: 16,
    targets: ["components/vector_icons/add_old.icon"],
    shapes: [line("M8 3.75 V12.25", 1.4), line("M3.75 8 H12.25", 1.4)],
  },
  {
    name: "tab-search",
    canvas: 24,
    targets: ["chrome/app/vector_icons/tab_search_tab_strip_old.icon"],
    shapes: [line("M7.5 10 L12 14.5", 1.8), line("M12 14.5 L16.5 10", 1.8)],
  },
];

const NUMBER = /-?\d*\.?\d+(?:e-?\d+)?/gi;
const COMMANDS = { M: ["MOVE_TO", 2], L: ["LINE_TO", 2], H: ["H_LINE_TO", 1], V: ["V_LINE_TO", 1], A: ["ARC_TO", 7], C: ["CUBIC_TO", 6], Q: ["QUADRATIC_TO", 4], Z: ["CLOSE", 0] };

/** Converts absolute SVG path data to .icon commands. Relative commands are not used here. */
function pathCommands(d) {
  const out = [];
  for (const [, letter, args] of d.matchAll(/([MLHVACQZ])([^MLHVACQZ]*)/g)) {
    const [name, count] = COMMANDS[letter];
    const numbers = (args.match(NUMBER) ?? []).map(Number);
    if (count === 0) {
      out.push(`${name},`);
      continue;
    }
    if (numbers.length === 0 || numbers.length % count !== 0) throw new Error(`bad ${letter} in ${d}`);
    for (let i = 0; i < numbers.length; i += count) out.push(`${name}, ${numbers.slice(i, i + count).join(", ")},`);
  }
  return out;
}

export function iconFile(icon) {
  const lines = [
    `// Orbit's ${icon.name} icon, generated by tools/design/browser-icons.mjs.`,
    "",
    `CANVAS_DIMENSIONS, ${icon.canvas},`,
  ];
  icon.shapes.forEach((shape, index) => {
    if (index > 0) lines.push("NEW_PATH,");
    if (shape.width) lines.push(`STROKE, ${shape.width}f,`);
    if (shape.kind === "circle") lines.push(`CIRCLE, ${shape.cx}, ${shape.cy}, ${shape.r},`);
    else lines.push(...pathCommands(shape.d));
  });
  return `${lines.join("\n")}\n`;
}

function svgShapes(icon, color) {
  return icon.shapes
    .map((shape) => {
      const paint = shape.width ? `fill="none" stroke="${color}" stroke-width="${shape.width}" stroke-linecap="round" stroke-linejoin="miter"` : `fill="${color}"`;
      return shape.kind === "circle" ? `<circle cx="${shape.cx}" cy="${shape.cy}" r="${shape.r}" ${paint}/>` : `<path d="${shape.d}" ${paint}/>`;
    })
    .join("");
}

function previewSheet() {
  const themes = [
    { bg: "#393b42", fg: "#e1e3e7" },
    { bg: "#ffffff", fg: "#171b2c" },
  ];
  const cell = 64;
  const width = ICONS.length * cell + 32;
  const rows = [];
  themes.forEach((theme, row) => {
    const y = row * 120;
    rows.push(`<rect x="0" y="${y}" width="${width}" height="120" fill="${theme.bg}"/>`);
    ICONS.forEach((icon, index) => {
      const x = 16 + index * cell;
      for (const [scale, dy] of [[1, 16], [2, 52]]) {
        const size = 20 * scale;
        const s = size / icon.canvas;
        rows.push(`<g transform="translate(${x + (cell - size) / 2} ${y + dy}) scale(${s})">${svgShapes(icon, theme.fg)}</g>`);
      }
    });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="240" viewBox="0 0 ${width} 240">${rows.join("")}</svg>\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command = "write", out] = process.argv.slice(2);
  if (command === "preview") {
    fs.writeFileSync(out, previewSheet());
    console.log(`wrote ${out}`);
  } else if (command === "write") {
    for (const icon of ICONS) {
      for (const target of icon.targets) {
        const file = path.join(OVERLAY, target);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, iconFile(icon));
        console.log(`wrote ${path.relative(ROOT, file)}`);
      }
    }
  } else {
    throw new Error(`unknown command ${command}`);
  }
}
