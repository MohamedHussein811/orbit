// Converts Orbit's declarativeNetRequest rules (filters/rules/*.json) into WebKit content
// blocker lists for the iPhone app. Rules WebKit cannot express exactly are skipped and counted,
// never approximated, the same policy as filter-compiler.mjs.
//
// Usage: node tools/apple-rules.mjs <output folder> [rules folder]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** WebKit compiles each list separately; smaller lists compile faster on older phones. */
export const LIST_SIZE = 50_000;

const TYPES = {
  main_frame: ["document"],
  sub_frame: ["document"],
  stylesheet: ["style-sheet"],
  script: ["script"],
  image: ["image"],
  font: ["font"],
  object: ["other"],
  xmlhttprequest: ["fetch"],
  ping: ["ping"],
  media: ["media"],
  websocket: ["websocket"],
  webtransport: ["other"],
  other: ["other"],
};
const ALL_DNR_TYPES = Object.keys(TYPES);
const HOST_PREFIX = "^[^:]+://+([^:/]+\\.)?";
const SEPARATOR = "[^a-zA-Z0-9_.%-]";

function escapeRegex(text) {
  return text.replace(/[.?+()[\]{}\\$|]/g, "\\$&");
}

function hostRegex(host) {
  return `${HOST_PREFIX}${escapeRegex(host)}[:/]`;
}

/** DNR urlFilter syntax to WebKit's regex subset (no alternation, no counted repeats). */
export function urlFilterRegex(filter) {
  let rest = filter;
  let out = "";
  if (rest.startsWith("||")) {
    out = HOST_PREFIX;
    rest = rest.slice(2);
  } else if (rest.startsWith("|")) {
    out = "^";
    rest = rest.slice(1);
  }
  let end = "";
  if (rest.endsWith("|")) {
    end = "$";
    rest = rest.slice(0, -1);
  }
  for (const char of rest) {
    if (char === "*") out += ".*";
    else if (char === "^") out += SEPARATOR;
    else out += escapeRegex(char);
  }
  if (out === "" || out === "^") out += ".*";
  return out + end;
}

/**
 * Trigger variants for the rule's resource types: null when it has none (all types), or one or
 * two { types, context } entries. main_frame and sub_frame share WebKit's "document" type, so
 * one without the other becomes its own entry with a load-context.
 */
function typeVariants(condition) {
  let types = condition.resourceTypes;
  if (!types && condition.excludedResourceTypes) {
    types = ALL_DNR_TYPES.filter((t) => !condition.excludedResourceTypes.includes(t));
  }
  if (!types) return null;
  const main = types.includes("main_frame");
  const sub = types.includes("sub_frame");
  const others = [...new Set(types.filter((t) => t !== "main_frame" && t !== "sub_frame").flatMap((t) => TYPES[t] ?? []))];
  const variants = [];
  if (main && sub) others.push("document");
  else if (main || sub) variants.push({ types: ["document"], context: main ? "top-frame" : "child-frame" });
  if (others.length) variants.unshift({ types: others.sort() });
  return variants;
}

function domains(list) {
  return list.map((d) => `*${d}`);
}

/**
 * One DNR rule to WebKit rules, or a skip reason. Rules with requestDomains become one WebKit
 * rule per host, since WebKit has no request host list.
 */
export function convertRule(rule) {
  const { condition, action } = rule;
  if (condition.regexFilter) return { skipped: "regex" };
  if (condition.requestMethods) return { skipped: "method" };
  if (condition.excludedRequestDomains) return { skipped: "excluded-request-domain" };
  if (condition.initiatorDomains && condition.excludedInitiatorDomains) return { skipped: "if-and-unless-domain" };
  const trigger = {};
  if (condition.domainType === "thirdParty") trigger["load-type"] = ["third-party"];
  if (condition.domainType === "firstParty") trigger["load-type"] = ["first-party"];
  if (condition.initiatorDomains) trigger["if-domain"] = domains(condition.initiatorDomains);
  if (condition.excludedInitiatorDomains) trigger["unless-domain"] = domains(condition.excludedInitiatorDomains);
  if (condition.isUrlFilterCaseSensitive) trigger["url-filter-is-case-sensitive"] = true;

  let webkitAction;
  if (action.type === "block") webkitAction = { type: "block" };
  else if (action.type === "allow") webkitAction = { type: "ignore-previous-rules" };
  else if (action.type === "allowAllRequests") {
    // Only a whole-site exception (||host^) maps exactly: everything loaded by pages of that site.
    const host = /^\|\|([a-z0-9.-]+)\^?$/.exec(condition.urlFilter ?? "")?.[1];
    if (!host || condition.requestDomains || trigger["if-domain"] || trigger["unless-domain"]) return { skipped: "allow-all" };
    return { rules: [{ trigger: { "url-filter": ".*", "if-domain": [`*${host}`] }, action: { type: "ignore-previous-rules" } }] };
  } else return { skipped: `action-${action.type}` };

  if (condition.requestDomains && condition.urlFilter) return { skipped: "host-and-filter" };
  const filters = condition.requestDomains
    ? condition.requestDomains.map(hostRegex)
    : [urlFilterRegex(condition.urlFilter ?? "*")];
  const variants = typeVariants(condition) ?? [{}];
  const rules = [];
  for (const filter of filters) {
    for (const { types, context } of variants) {
      const variant = { "url-filter": filter, ...trigger };
      if (types) variant["resource-type"] = types;
      if (context) variant["load-context"] = [context];
      rules.push({ trigger: variant, action: webkitAction });
    }
  }
  return { rules };
}

/**
 * All DNR rule sets to WebKit lists. WebKit lists apply independently, so every list carries
 * all exceptions after its block rules, and then the important blocks that override them.
 */
export function convertRuleSets(ruleSets) {
  const blocks = [];
  const allows = [];
  const important = [];
  const stats = { input: 0, output: 0, skipped: {} };
  for (const rules of ruleSets) {
    for (const rule of rules) {
      stats.input++;
      const result = convertRule(rule);
      if (result.skipped) {
        stats.skipped[result.skipped] = (stats.skipped[result.skipped] ?? 0) + 1;
        continue;
      }
      const target = rule.action.type !== "block" ? allows : rule.priority >= 3 ? important : blocks;
      target.push(...result.rules);
    }
  }
  if (allows.length === 0) blocks.push(...important.splice(0));
  if (blocks.length === 0 && important.length) blocks.push(important.pop());
  const room = LIST_SIZE - allows.length - important.length;
  if (room <= 0) throw new Error(`exceptions alone (${allows.length + important.length}) exceed a list`);
  const lists = [];
  for (let i = 0; i < blocks.length; i += room) {
    lists.push([...blocks.slice(i, i + room), ...allows, ...important]);
  }
  stats.output = blocks.length + allows.length + important.length;
  return { lists, stats };
}

function main() {
  const [output, source = "filters/rules"] = process.argv.slice(2);
  if (!output) throw new Error("usage: node tools/apple-rules.mjs <output folder> [rules folder]");
  const meta = { generated: new Date().toISOString(), lists: [] };
  fs.mkdirSync(output, { recursive: true });
  for (const name of ["ads", "trackers", "threats"]) {
    const rules = JSON.parse(fs.readFileSync(path.join(source, `${name}.json`), "utf8"));
    const { lists, stats } = convertRuleSets([rules]);
    lists.forEach((list, index) => {
      const file = `${name}-${index + 1}.json`;
      fs.writeFileSync(path.join(output, file), JSON.stringify(list));
      meta.lists.push({ id: `${name}-${index + 1}`, group: name, file, rules: list.length });
    });
    console.log(name, JSON.stringify(stats));
  }
  fs.writeFileSync(path.join(output, "lists.json"), JSON.stringify(meta, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
