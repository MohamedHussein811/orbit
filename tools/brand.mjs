// Puts Orbit's name and logos into the resource packs of a built host.
//   node tools/brand.mjs <folder holding the .pak files> <CEF include folder>
// Runs after the engine's packs are copied, so it always starts from CEF's originals.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { ENCODING_UTF8, readPak, writePak } from "./lib-pak.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICONS = path.join(ROOT, "branding", "icons");
const PRODUCT = "Orbit";

// Engine attribution stays as it is, because it is true of the engine and not of the product.
const KEEP_STRINGS = ["IDS_ABOUT_VERSION_COMPANY_NAME", "IDS_ABOUT_VERSION_COPYRIGHT"];
// In this string only the name of the linked project stays.
const LINKED_ATTRIBUTION = "IDS_VERSION_UI_LICENSE";

// Exact text in Chromium's Settings code, and what replaces it. A change in the engine makes the
// build stop here rather than silently bring these items back.
const SETTINGS_PATCHES = [
  {
    // The "AI innovations" section: its menu item and its route both read this flag.
    find: 'loadTimeData.getBoolean("showAiPage")',
    replace: "false",
  },
  {
    // "Get help" leads to Google's support site for Chrome.
    find: /<cr-link-row class="hr" id="help"[^>]*><\/cr-link-row>/g,
    replace: "",
  },
  {
    // Safe Browsing does not work in this engine build, so a switch for it would be a fake control.
    find: '<div id="safeBrowsingSection">',
    replace: '<div id="safeBrowsingSection" hidden>',
  },
  {
    // Removes Safety Check, whose main recommendation is to turn that switch on. Settings' own page
    // list needs every page named once a list exists, as the guest version shows.
    find: 'function createPageVisibility(){if(!loadTimeData.getBoolean("isGuest")){return undefined}',
    replace:
      'function createPageVisibility(){if(!loadTimeData.getBoolean("isGuest")){return{a11y:true,ai:false,appearance:true,autofill:true,defaultBrowser:true,downloads:true,extensions:true,languages:true,onStartup:true,people:true,performance:true,privacy:true,reset:true,safetyHub:false,system:true,yourSavedInfo:true}}',
  },
  {
    // The check needs a Google account, which Orbit does not use.
    find: '<settings-toggle-button id="passwordsLeakToggle"',
    replace: '<settings-toggle-button hidden id="passwordsLeakToggle"',
  },
  {
    // The Privacy Guide walks through Safe Browsing and Google services.
    find: 'loadTimeData.getBoolean("showPrivacyGuide")',
    replace: "false",
  },
  {
    // The Sync and Google services rows lead to controls for accounts Orbit does not use.
    find: /\?hidden="\$\{!?this\.shouldHideSyncSetupLinkRow_\(\)\}"/g,
    replace: "hidden",
  },
];

// English text that describes Google or misstates what happened.
const ENGLISH_STRINGS = {
  IDS_SETTINGS_PEOPLE: "Your profile",
  // Orbit made this choice, not the person, because Safe Browsing does not work in this engine build.
  IDS_BLOCK_DOWNLOAD_REASON_UNVERIFIED_NO_SAFE_BROWSING: "Orbit can't check this file for malware. Download it only if you trust this site.",
  IDS_DOWNLOAD_BUBBLE_SUBPAGE_SUMMARY_WARNING_NO_SAFE_BROWSING: "Orbit can't check this file for malware",
};

function unpack(raw) {
  if (raw[0] === 0x1f && raw[1] === 0x8b) return { data: zlib.gunzipSync(raw), kind: "gzip" };
  if (raw[0] === 0x1e && raw[1] === 0x9b) return { data: zlib.brotliDecompressSync(raw.subarray(8)), kind: "brotli" };
  return { data: raw, kind: "plain" };
}

function pack(data, kind) {
  if (kind === "gzip") return zlib.gzipSync(data, { level: 9 });
  if (kind === "plain") return data;
  const header = Buffer.alloc(8);
  header[0] = 0x1e;
  header[1] = 0x9b;
  header.writeUIntLE(data.length, 2, 6);
  return Buffer.concat([header, zlib.brotliCompressSync(data)]);
}

function patchSettings(file) {
  const pak = readPak(file);
  const applied = new Set();
  for (const [id, raw] of pak.resources) {
    if (raw[0] !== 0x1f && raw[0] !== 0x1e) continue;
    let unpacked;
    try {
      unpacked = unpack(raw);
    } catch {
      continue;
    }
    if (!unpacked.data.includes("settings-")) continue;
    let text = unpacked.data.toString("utf8");
    let changed = false;
    for (const patch of SETTINGS_PATCHES) {
      const found = typeof patch.find === "string" ? text.includes(patch.find) : text.search(patch.find) !== -1;
      if (found) {
        text = text.replaceAll(patch.find, patch.replace);
        applied.add(patch);
        changed = true;
      }
    }
    if (changed) pak.resources.set(id, pack(Buffer.from(text, "utf8"), unpacked.kind));
  }
  for (const patch of SETTINGS_PATCHES) {
    if (!applied.has(patch)) throw new Error(`Settings no longer contains: ${patch.find}`);
  }
  writePak(file, pak);
}

function stringIds(includeDir) {
  const header = fs.readFileSync(path.join(includeDir, "cef_pack_strings.h"), "utf8");
  const ids = new Map();
  for (const m of header.matchAll(/^#define (IDS_\w+) (\d+)$/gm)) ids.set(m[1], Number(m[2]));
  for (const name of [...KEEP_STRINGS, LINKED_ATTRIBUTION, ...Object.keys(ENGLISH_STRINGS)]) {
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

/** English packs are named en-US.pak or en-GB.pak on Windows and Linux, and en.lproj on macOS. */
const isEnglish = (file) => /(^|[\\/])en[-_](US|GB)\.pak$|[\\/]en(_GB)?\.lproj[\\/]/.test(file);

function brandLocale(file, ids) {
  const pak = readPak(file);
  if (pak.encoding !== ENCODING_UTF8) throw new Error(`${file}: expected UTF-8 strings`);
  if (isEnglish(file)) {
    for (const [name, text] of Object.entries(ENGLISH_STRINGS)) pak.resources.set(ids.get(name), Buffer.from(text, "utf8"));
  }
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
  patchSettings(path.join(dir, "resources.pak"));
  console.log(`branded ${locales.length} locales (${strings} strings) and ${images} logos in ${dir}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  brand(process.argv[2], process.argv[3]);
}
