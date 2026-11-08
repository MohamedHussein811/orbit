// Puts Orbit's name and logos into the resource packs of a built host.
//   node tools/brand.mjs <folder holding the .pak files> <CEF include folder>
// Runs after the engine's packs are copied, so it always starts from CEF's originals.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENCODING_UTF8, readPak, writePak } from "./lib-pak.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = path.join(ROOT, "branding", "icons");
const PRODUCT = "Orbit";

// Engine attribution stays as it is, because it is true of the engine and not of the product.
const KEEP_STRINGS = ["IDS_ABOUT_VERSION_COMPANY_NAME", "IDS_ABOUT_VERSION_COPYRIGHT"];
// In this string only the name of the linked project stays.
const LINKED_ATTRIBUTION = "IDS_VERSION_UI_LICENSE";

function stringIds(includeDir) {
  const header = fs.readFileSync(path.join(includeDir, "cef_pack_strings.h"), "utf8");
  const ids = new Map();
  for (const m of header.matchAll(/^#define (IDS_\w+) (\d+)$/gm)) ids.set(m[1], Number(m[2]));
  for (const name of [...KEEP_STRINGS, LINKED_ATTRIBUTION]) {
    if (!ids.has(name)) throw new Error(`${name} is missing from the engine's string list`);
  }
  return ids;
}

function rebrandText(text, keepLinkedName) {
  if (keepLinkedName) {
    return text
      .replace(/(<a [^>]*>)Chromium(<\/a>)/g, "$1\u0000$2")
      .replaceAll("Chromium", PRODUCT)
      .replaceAll("\u0000", "Chromium");
  }
  return text.replaceAll("Chromium", PRODUCT);
}

function brandLocale(file, ids) {
  const pak = readPak(file);
  if (pak.encoding !== ENCODING_UTF8) throw new Error(`${file}: expected UTF-8 strings`);
  const keep = new Set(KEEP_STRINGS.map((name) => ids.get(name)));
  const linked = ids.get(LINKED_ATTRIBUTION);
  let changed = 0;
  for (const [id, data] of pak.resources) {
    if (keep.has(id) || !data.includes("Chromium")) continue;
    pak.resources.set(id, Buffer.from(rebrandText(data.toString("utf8"), id === linked), "utf8"));
    changed++;
  }
  writePak(file, pak);
  return changed;
}

function brandLogos(file, logos) {
  const pak = readPak(file);
  let changed = 0;
  for (const [id, data] of pak.resources) {
    const replacement = logos.get(crypto.createHash("sha256").update(data).digest("hex"));
    if (replacement) {
      pak.resources.set(id, fs.readFileSync(path.join(ICONS, replacement)));
      changed++;
    }
  }
  if (changed) writePak(file, pak);
  return changed;
}

/** Locale packs sit in locales/ on Windows and Linux, and in <lang>.lproj/ on macOS. */
function localeFiles(dir) {
  const flat = path.join(dir, "locales");
  if (fs.existsSync(flat)) {
    return fs.readdirSync(flat).filter((f) => f.endsWith(".pak")).map((f) => path.join(flat, f));
  }
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".lproj"))
    .map((f) => path.join(dir, f, "locale.pak"))
    .filter((f) => fs.existsSync(f));
}

export function brand(dir, includeDir) {
  const ids = stringIds(includeDir);
  const locales = localeFiles(dir);
  if (locales.length === 0) throw new Error(`no locale packs in ${dir}`);
  let strings = 0;
  for (const file of locales) strings += brandLocale(file, ids);

  // Maps the SHA-256 of each Chromium logo in the pinned engine to the file that replaces it.
  const logos = new Map(Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, "branding", "engine-logos.json"), "utf8"))));
  let images = 0;
  for (const name of ["chrome_100_percent.pak", "chrome_200_percent.pak"]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) images += brandLogos(file, logos);
  }
  if (images === 0) throw new Error("no engine logo matched. Update branding/engine-logos.json for this engine");
  console.log(`branded ${locales.length} locales (${strings} strings) and ${images} logos in ${dir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  brand(process.argv[2], process.argv[3]);
}
