// Compiles Adblock Plus style filter lists into declarativeNetRequest rules, which Chromium
// evaluates natively. Filters with no exact equivalent are skipped and counted, never approximated.
import { domainToASCII } from "node:url";

/** Allow rules get IDs from here up, so the blocking counter can tell them from block rules. */
export const ALLOW_ID_BASE = 1_000_000;
const DOMAIN_CHUNK = 4000;

const PRIORITY = { block: 1, allow: 2, important: 3 };

const RESOURCE_TYPES = {
  script: "script",
  image: "image",
  stylesheet: "stylesheet",
  css: "stylesheet",
  object: "object",
  xmlhttprequest: "xmlhttprequest",
  xhr: "xmlhttprequest",
  subdocument: "sub_frame",
  frame: "sub_frame",
  ping: "ping",
  beacon: "ping",
  media: "media",
  font: "font",
  websocket: "websocket",
  webtransport: "webtransport",
  other: "other",
  document: "main_frame",
  doc: "main_frame",
};
const ALL_TYPES = [...new Set(Object.values(RESOURCE_TYPES))];

const OPTIONS_SHAPE = /^~?[\w-]+(=[^,]*)?(,~?[\w-]+(=[^,]*)?)*$/;
const COSMETIC = /(#@?#|#\?#|#@\?#|#\$#|#@\$#|#%#|#@%#|\$\$|\$@\$)/;

function normalizeDomain(raw) {
  const ascii = domainToASCII(raw.trim().toLowerCase());
  if (!ascii || ascii.includes("*") || ascii.includes("/") || !ascii.includes(".")) return null;
  return ascii;
}

function parseDomainOption(value, out) {
  for (const part of value.split("|")) {
    const negated = part.startsWith("~");
    const domain = normalizeDomain(negated ? part.slice(1) : part);
    if (!domain) return false;
    (negated ? out.excludedInitiatorDomains : out.initiatorDomains).push(domain);
  }
  return true;
}

/** Returns the rule's condition fields and flags, or null when any option has no exact equivalent. */
function parseOptions(text) {
  const parsed = { types: [], excludedTypes: [], initiatorDomains: [], excludedInitiatorDomains: [], excludedRequestDomains: [], methods: [], domainType: null, caseSensitive: false, important: false };
  if (!text) return parsed;
  for (const option of text.split(",")) {
    const equals = option.indexOf("=");
    const rawName = equals === -1 ? option : option.slice(0, equals);
    const value = equals === -1 ? "" : option.slice(equals + 1);
    const negated = rawName.startsWith("~");
    const name = negated ? rawName.slice(1) : rawName;
    if (name === "third-party" || name === "3p") {
      parsed.domainType = negated ? "firstParty" : "thirdParty";
    } else if (name === "first-party" || name === "1p") {
      parsed.domainType = negated ? "thirdParty" : "firstParty";
    } else if (name === "domain" || name === "from") {
      if (!parseDomainOption(value, parsed)) return null;
    } else if (name === "denyallow") {
      for (const part of value.split("|")) {
        const domain = normalizeDomain(part);
        if (!domain) return null;
        parsed.excludedRequestDomains.push(domain);
      }
    } else if (name === "method") {
      for (const method of value.split("|")) {
        if (method.startsWith("~")) return null;
        parsed.methods.push(method.toLowerCase());
      }
    } else if (name === "match-case") {
      parsed.caseSensitive = !negated;
    } else if (name === "important") {
      parsed.important = true;
    } else if (name === "all") {
      parsed.types.push(...ALL_TYPES);
    } else if (name === "popup") {
      // Popups have no equivalent. A filter for popups alone is dropped below, with no types left.
      parsed.hadPopup = true;
    } else if (RESOURCE_TYPES[name]) {
      (negated ? parsed.excludedTypes : parsed.types).push(RESOURCE_TYPES[name]);
    } else {
      return null;
    }
  }
  if (parsed.hadPopup && parsed.types.length === 0) return null;
  return parsed;
}

function splitOptions(line) {
  const at = line.lastIndexOf("$");
  if (at <= 0) return [line, ""];
  const candidate = line.slice(at + 1);
  if (candidate && OPTIONS_SHAPE.test(candidate)) return [line.slice(0, at), candidate];
  return [line, ""];
}

function cleanPattern(pattern) {
  let result = pattern;
  while (result.endsWith("*")) result = result.slice(0, -1);
  while (result.startsWith("*")) result = result.slice(1);
  return result;
}

/** Parses one list line. Returns null for comments, or { skipped } or { rule fields }. */
export function parseFilter(raw) {
  const line = raw.trim();
  if (!line || line.startsWith("!") || line.startsWith("[")) return null;
  if (COSMETIC.test(line)) return { skipped: "cosmetic" };

  const allow = line.startsWith("@@");
  const [patternText, optionText] = splitOptions(allow ? line.slice(2) : line);
  if (patternText.startsWith("/") && patternText.endsWith("/") && patternText.length > 1) return { skipped: "regex" };

  const options = parseOptions(optionText);
  if (!options) return { skipped: "option" };

  const pattern = cleanPattern(patternText);
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7f]/.test(pattern)) return { skipped: "non-ascii" };
  if (/\|/.test(pattern.replace(/^\|\|?/, "").replace(/\|$/, ""))) return { skipped: "pattern" };
  if (pattern.startsWith("||*")) return { skipped: "pattern" };

  const hasScope = options.initiatorDomains.length > 0;
  const bare = pattern.replace(/^\|\|?/, "").replace(/[\^|]+$/, "");
  if (bare.length < 3 && !hasScope) return { skipped: "too-broad" };

  const hostOnly = /^\|\|([a-z0-9.-]+\.[a-z0-9-]+)\^$/i.exec(pattern);
  return { allow, pattern, host: hostOnly ? hostOnly[1].toLowerCase() : null, options };
}

function conditionFor(parsed) {
  const { options } = parsed;
  const condition = {};
  if (options.domainType) condition.domainType = options.domainType;
  if (options.initiatorDomains.length) condition.initiatorDomains = [...new Set(options.initiatorDomains)].sort();
  if (options.excludedInitiatorDomains.length) condition.excludedInitiatorDomains = [...new Set(options.excludedInitiatorDomains)].sort();
  if (options.excludedRequestDomains.length) condition.excludedRequestDomains = [...new Set(options.excludedRequestDomains)].sort();
  if (options.methods.length) condition.requestMethods = [...new Set(options.methods)].sort();
  if (options.types.length) condition.resourceTypes = [...new Set(options.types)].sort();
  else if (options.excludedTypes.length) condition.excludedResourceTypes = [...new Set(options.excludedTypes)].sort();
  return condition;
}

function actionFor(parsed) {
  const types = parsed.options.types;
  // An exception for a whole document allows everything in it.
  if (parsed.allow && types.length > 0 && types.every((t) => t === "main_frame")) return "allowAllRequests";
  return parsed.allow ? "allow" : "block";
}

/**
 * Compiles plain lists of dangerous hostnames. Page loads go to Orbit's warning page, which offers
 * a way back, and everything else from those hosts is blocked. Entries with a path are left out:
 * they mostly name files on hacked but otherwise ordinary sites, and churn within hours.
 */
export function compileHosts(texts, { redirect }) {
  const hosts = new Set();
  const stats = { lines: 0, compiled: 0, skipped: {} };
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim().toLowerCase();
      if (!line || line.startsWith("!") || line.startsWith("#")) continue;
      stats.lines++;
      if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(line)) {
        hosts.add(line);
        stats.compiled++;
      } else {
        stats.skipped.path = (stats.skipped.path ?? 0) + 1;
      }
    }
  }
  const sorted = [...hosts].sort();
  const rules = [];
  let id = 1;
  for (let i = 0; i < sorted.length; i += DOMAIN_CHUNK) {
    const requestDomains = sorted.slice(i, i + DOMAIN_CHUNK);
    rules.push({
      id: id++,
      priority: PRIORITY.important,
      action: { type: "redirect", redirect: { regexSubstitution: `${redirect}#\\0` } },
      condition: { regexFilter: "^https?://.*", requestDomains, resourceTypes: ["main_frame"] },
    });
    rules.push({
      id: id++,
      priority: PRIORITY.important,
      action: { type: "block" },
      condition: { requestDomains, excludedResourceTypes: ["main_frame"] },
    });
  }
  return { rules, stats };
}

/**
 * Compiles list text into DNR rules. Rules for whole hostnames that share the same conditions are
 * merged into one rule with a domain list, which keeps the ruleset small.
 */
export function compileFilters(texts, { firstId = 1, firstAllowId = ALLOW_ID_BASE } = {}) {
  const stats = { lines: 0, compiled: 0, skipped: {} };
  const groups = new Map();
  const single = new Map();
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      const parsed = parseFilter(line);
      if (!parsed) continue;
      stats.lines++;
      if (parsed.skipped) {
        stats.skipped[parsed.skipped] = (stats.skipped[parsed.skipped] ?? 0) + 1;
        continue;
      }
      stats.compiled++;
      const type = actionFor(parsed);
      const condition = conditionFor(parsed);
      if (type === "allowAllRequests") {
        condition.resourceTypes = ["main_frame", "sub_frame"];
        delete condition.excludedResourceTypes;
      }
      const priority = parsed.options.important ? PRIORITY.important : parsed.allow ? PRIORITY.allow : PRIORITY.block;
      if (parsed.host && !parsed.options.caseSensitive) {
        const key = JSON.stringify([type, priority, condition]);
        if (!groups.has(key)) groups.set(key, { type, priority, condition, hosts: new Set() });
        groups.get(key).hosts.add(parsed.host);
      } else {
        if (parsed.pattern) condition.urlFilter = parsed.pattern;
        if (parsed.options.caseSensitive) condition.isUrlFilterCaseSensitive = true;
        single.set(JSON.stringify([type, priority, condition]), { type, priority, condition });
      }
    }
  }

  const rules = [];
  const add = ({ type, priority, condition }) => {
    const isAllow = type !== "block";
    rules.push({ id: isAllow ? firstAllowId++ : firstId++, priority, action: { type }, condition });
  };
  for (const group of groups.values()) {
    const hosts = [...group.hosts].sort();
    for (let i = 0; i < hosts.length; i += DOMAIN_CHUNK) {
      add({ ...group, condition: { requestDomains: hosts.slice(i, i + DOMAIN_CHUNK), ...group.condition } });
    }
  }
  for (const entry of single.values()) add(entry);
  return { rules, stats };
}
