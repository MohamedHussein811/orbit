// Renders branding/orbit-mark.svg into branding/icons: PNG sizes, orbit.ico and orbit.icns. Then
// run tools/chromium/make-icons.ps1 to place them in the Chromium overlay.
//   node tools/design/render-logo.mjs
// Needs @resvg/resvg-js in .cache/node_modules (the rest of the build does not).
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const { Resvg } = require(path.join(ROOT, ".cache", "node_modules", "@resvg", "resvg-js"));
const OUT = path.join(ROOT, "branding", "icons");
const svg = fs.readFileSync(path.join(ROOT, "branding", "orbit-mark.svg"), "utf8");

const render = (size) => Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng());

function writeIco(file, images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + images.length * 16;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  fs.writeFileSync(file, Buffer.concat([header, ...entries, ...images.map((image) => image.png)]));
}

function writeIcns(file, images) {
  const types = { 16: "icp4", 32: "icp5", 64: "icp6", 128: "ic07", 256: "ic08", 512: "ic09", 1024: "ic10" };
  const chunks = [];
  for (const { size, png } of images) {
    if (!types[size]) continue;
    const head = Buffer.alloc(8);
    head.write(types[size], 0, "ascii");
    head.writeUInt32BE(png.length + 8, 4);
    chunks.push(head, png);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write("icns", 0, "ascii");
  head.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(file, Buffer.concat([head, body]));
}

const sizes = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const images = sizes.map((size) => ({ size, png: render(size) }));
const bySize = new Map(images.map((image) => [image.size, image.png]));
for (const size of [16, 32, 48, 64, 128, 256, 512]) fs.writeFileSync(path.join(OUT, `orbit-${size}.png`), bySize.get(size));
writeIco(path.join(OUT, "orbit.ico"), [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: bySize.get(size) })));
writeIcns(path.join(OUT, "orbit.icns"), images);
console.log(`wrote icons to ${path.relative(ROOT, OUT)}`);
