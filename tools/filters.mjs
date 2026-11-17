// Rebuilds the blocking rules in filters/rules from the lists in filters/sources.json.
//   node tools/filters.mjs update
// The rule files are committed, so a build needs no download and git records every change.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compileCosmetic, compileFilters, compileHosts, compilePopups, compileScriptlets, cosmeticShard } from "./filter-compiler.mjs";

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

/** Downloads a list with the files it includes (`!#include name`, relative to the list). */
async function downloadList(url, seen = new Set()) {
  if (seen.has(url)) return "";
  seen.add(url);
  const text = await download(url);
  const parts = [];
  for (const line of text.split(/\r?\n/)) {
    const include = /^!#include\s+(\S+)/.exec(line);
    if (include) parts.push(await downloadList(new URL(include[1], url).href, seen));
    else parts.push(line);
  }
  return parts.join("\n");
}

/** Capabilities lists may test with `!#if`. Orbit applies rules the way uBlock Origin Lite
 * (Manifest V3, Chromium) does. */
const ENVIRONMENT = new Set(["env_chromium", "env_mv3", "ext_ublock", "cap_user_stylesheet"]);

function evaluateCondition(expression) {
  const tokens = expression.match(/!|\(|\)|&&|\|\||[\w-]+/g) ?? [];
  let at = 0;
  const primary = () => {
    const token = tokens[at++];
    if (token === "!") return !primary();
    if (token === "(") {
      const value = or();
      at++;
      return value;
    }
    return ENVIRONMENT.has(token);
  };
  const and = () => {
    let value = primary();
    while (tokens[at] === "&&") {
      at++;
      value = primary() && value;
    }
    return value;
  };
  const or = () => {
    let value = and();
    while (tokens[at] === "||") {
      at++;
      value = and() || value;
    }
    return value;
  };
  return or();
}

/**
 * Keeps the lines whose `!#if` blocks hold for Orbit. A Safari block made only of network filters
 * is kept too: those are lookahead-free versions of regex filters that Chromium's rule engine
 * (RE2) cannot read in their usual form.
 */
export function preprocess(text) {
  const out = [];
  const stack = [];
  const networkOnly = (lines) => {
    const rules = lines.filter((line) => line.trim() && !line.startsWith("!"));
    return rules.length > 0 && rules.every((line) => !/#[@?$%]?#|\$\$/.test(line));
  };
  for (const line of text.split(/\r?\n/)) {
    const directive = /^!#(if|else|endif)\b\s*(.*)$/.exec(line.trim());
    if (directive) {
      const [, kind, expression] = directive;
      if (kind === "if") stack.push({ active: evaluateCondition(expression), safari: expression.trim() === "env_safari", held: [] });
      else if (kind === "else" && stack.length) {
        const frame = stack.at(-1);
        if (frame.safari && stack.slice(0, -1).every((outer) => outer.active) && networkOnly(frame.held)) out.push(...frame.held);
        frame.active = !frame.active;
        frame.safari = false;
      } else if (kind === "endif") {
        const frame = stack.pop();
        if (frame?.safari && stack.every((outer) => outer.active) && networkOnly(frame.held)) out.push(...frame.held);
      }
      continue;
    }
    if (stack.every((frame) => frame.active)) out.push(line);
    else if (stack.at(-1)?.safari && stack.slice(0, -1).every((frame) => frame.active)) stack.at(-1).held.push(line);
  }
  return out.join("\n");
}

/** Refuses a list that came back truncated or empty, which would silently weaken blocking. Small
 * regional lists set their own minimum in sources.json. */
function checkSize(name, text, minimum = 100_000) {
  if (text.length < minimum) throw new Error(`${name} looks truncated: ${text.length} bytes`);
}

export const SCRIPTLET_SHARDS = 32;

/**
 * Splits scriptlet data so a page runs only what concerns it. Hostnames go to shards, each of
 * which the extension registers for its own hosts only. Entities such as "example.*" cannot be
 * expressed as match patterns, so they share one file that runs on every page.
 */
function writeScriptlets({ calls, sites, except }, skip = []) {
  const dir = path.join(RULES_DIR, "scriptlets");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const groups = new Map();
  for (const [key, indexes] of Object.entries(sites)) {
    if (skip.some((site) => key === site || key.endsWith(`.${site}`))) continue;
    const group = key.endsWith(".*") ? "entities" : `hosts-${cosmeticShard(key) % SCRIPTLET_SHARDS}`;
    if (!groups.has(group)) groups.set(group, {});
    groups.get(group)[key] = indexes;
  }
  const index = { shards: [] };
  for (const [name, groupSites] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const used = [...new Set(Object.values(groupSites).flat())].sort((a, b) => a - b);
    const local = new Map(used.map((global, position) => [global, position]));
    const remap = (indexes) => indexes.filter((i) => i === -1 || local.has(i)).map((i) => (i === -1 ? -1 : local.get(i)));
    const data = {
      calls: used.map((i) => calls[i]),
      sites: Object.fromEntries(Object.entries(groupSites).map(([key, indexes]) => [key, remap(indexes)])),
      except: Object.fromEntries(Object.entries(except).map(([key, indexes]) => [key, remap(indexes)]).filter(([, indexes]) => indexes.length)),
    };
    fs.writeFileSync(path.join(dir, `${name}.json`), `${JSON.stringify(data)}\n`);
    index.shards.push(name === "entities" ? { name, everywhere: true } : { name, hosts: Object.keys(groupSites).sort() });
  }
  fs.writeFileSync(path.join(dir, "index.json"), `${JSON.stringify(index)}\n`);
}

/** One rule per line, so git stores small changes between updates as small differences. */
const ruleFile = (rules) => `[\n${rules.map((rule) => JSON.stringify(rule)).join(",\n")}\n]\n`;

async function update() {
  const sources = JSON.parse(fs.readFileSync(SOURCES, "utf8"));
  const meta = { generated: new Date().toISOString(), lists: {}, rulesets: {} };
  const texts = {};
  for (const [id, list] of Object.entries(sources.lists)) {
    const text = preprocess(await downloadList(list.url));
    checkSize(id, text, list.minBytes);
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
  const popups = compilePopups(sources.popups.map((id) => texts[id]));
  fs.writeFileSync(path.join(RULES_DIR, "popups.json"), `${JSON.stringify(popups)}
`);
  meta.popups = { hosts: popups.hosts.length, scoped: Object.keys(popups.scoped).length };
  console.error("compiled popups:", JSON.stringify(meta.popups));
  const scriptlets = compileScriptlets((sources.scriptlets ?? []).map((id) => texts[id]));
  // Sites Orbit handles with its own script (sites/youtube.ts) take no list scriptlets.
  writeScriptlets(scriptlets, sources.scriptletsSkip ?? []);
  meta.scriptlets = { calls: scriptlets.calls.length, sites: Object.keys(scriptlets.sites).length, ...scriptlets.stats };
  console.error("compiled scriptlets:", JSON.stringify(meta.scriptlets));
  fs.writeFileSync(path.join(RULES_DIR, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "update") await update();
  else throw new Error("usage: filters.mjs update");
}
