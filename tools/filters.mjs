// Rebuilds the blocking rules in filters/rules from the lists in filters/sources.json.
//   node tools/filters.mjs update
// The rule files are committed, so a build needs no download and git records every change.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileCosmetic, compileFilters, compileHosts } from "./filter-compiler.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCES = path.join(ROOT, "filters", "sources.json");
export const RULES_DIR = path.join(ROOT, "filters", "rules");

const sha256 = (data) => crypto.createHash("sha256").update(data).digest("hex");

/** Chromium derives an extension's ID from its public key. */
export function extensionId() {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8"));
  const digest = crypto.createHash("sha256").update(Buffer.from(manifest.key, "base64")).digest("hex");
  return [...digest.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join("");
}

async function download(url) {
  const res = await fetch(url, { headers: { "user-agent": "orbit-filter-build" } });
  if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
  return res.text();
}

/** Refuses a list that came back truncated or empty, which would silently weaken blocking. */
function checkSize(name, text) {
  if (text.length < 100_000) throw new Error(`${name} looks truncated: ${text.length} bytes`);
}

/** One rule per line, so git stores small changes between updates as small differences. */
const ruleFile = (rules) => `[\n${rules.map((rule) => JSON.stringify(rule)).join(",\n")}\n]\n`;

async function update() {
  const sources = JSON.parse(fs.readFileSync(SOURCES, "utf8"));
  const meta = { generated: new Date().toISOString(), lists: {}, rulesets: {} };
  const texts = {};
  for (const [id, list] of Object.entries(sources.lists)) {
    const text = await download(list.url);
    checkSize(id, text);
    texts[id] = text;
    meta.lists[id] = { name: list.name, license: list.license, attribution: list.attribution, homepage: list.homepage, url: list.url, sha256: sha256(text), bytes: text.length };
    console.error(`downloaded ${id}: ${text.length} bytes`);
  }
  fs.mkdirSync(RULES_DIR, { recursive: true });
  const redirect = `chrome-extension://${extensionId()}/blocked/blocked.html`;
  for (const [name, ruleset] of Object.entries(sources.rulesets)) {
    const inputs = ruleset.lists.map((id) => texts[id]);
    const { rules, stats } = ruleset.format === "hosts" ? compileHosts(inputs, { redirect }) : compileFilters(inputs);
    fs.writeFileSync(path.join(RULES_DIR, `${name}.json`), ruleFile(rules));
    meta.rulesets[name] = { rules: rules.length, ...stats };
    console.error(`compiled ${name}: ${rules.length} rules`, JSON.stringify(stats));
  }
  const cosmeticInputs = sources.cosmetic.map((id) => texts[id]);
  const cosmetic = compileCosmetic(cosmeticInputs);
  // One rule per selector, so one selector the browser rejects cannot cancel the others.
  fs.writeFileSync(path.join(RULES_DIR, "cosmetic-generic.css"), cosmetic.generic.map((selector) => `${selector}{display:none!important}\n`).join(""));
  const shardDir = path.join(RULES_DIR, "cosmetic");
  fs.rmSync(shardDir, { recursive: true, force: true });
  fs.mkdirSync(shardDir, { recursive: true });
  cosmetic.shards.forEach((shard, index) => {
    const lines = Object.entries(shard).map(([host, entry]) => `${JSON.stringify(host)}:${JSON.stringify(entry)}`);
    fs.writeFileSync(path.join(shardDir, `${index}.json`), `{\n${lines.join(",\n")}\n}\n`);
  });
  meta.cosmetic = { generic: cosmetic.generic.length, sites: cosmetic.shards.reduce((total, shard) => total + Object.keys(shard).length, 0), ...cosmetic.stats };
  console.error("compiled cosmetic:", JSON.stringify(meta.cosmetic));
  fs.writeFileSync(path.join(RULES_DIR, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "update") await update();
  else throw new Error("usage: filters.mjs update");
}
