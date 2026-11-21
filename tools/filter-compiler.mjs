// Compiles Adblock Plus style filter lists into declarativeNetRequest rules, which Chromium
// evaluates natively. Filters with no exact equivalent are skipped and counted, never approximated.
import { domainToASCII } from "node:url";

/** Allow rules get IDs from here up, so the blocking counter can tell them from block rules. */
export const ALLOW_ID_BASE = 1_000_000;
const DOMAIN_CHUNK = 4000;

// A redirect beats a plain block of the same request, and loses to an exception (same priority,
// where the rule engine lets allow win).
const PRIORITY = { block: 1, redirect: 2, allow: 2, important: 3 };

/**
 * Harmless stand-ins for blocked files, from uBlock Origin's resource library (GPL-3.0, vendored in
 * filters/rules/resources by tools/filters.mjs). A page that checks whether its ad script loaded
 * finds the script's interface working with no ads behind it. Every name lists use, by file.
 */
export const REDIRECT_RESOURCES = {
  "1x1.gif": ["1x1-transparent.gif"],
  "2x2.png": ["2x2-transparent.png"],
  "3x2.png": ["3x2-transparent.png"],
  "32x32.png": ["32x32-transparent.png"],
  "amazon_ads.js": ["amazon-adsystem.com/aax2/amzn_ads.js"],
  "amazon_apstag.js": [],
  "ampproject_v0.js": ["ampproject.org/v0.js"],
  "adthrive_abd.js": [],
  "chartbeat.js": ["static.chartbeat.com/chartbeat.js"],
  "doubleclick_instream_ad_status.js": ["doubleclick.net/instream/ad_status.js"],
  "empty": [],
  "fingerprint2.js": [],
  "fingerprint3.js": [],
  "freestar_pubfig.js": [],
  "google-analytics_analytics.js": ["google-analytics.com/analytics.js", "googletagmanager_gtm.js", "googletagmanager.com/gtm.js"],
  "google-analytics_cx_api.js": ["google-analytics.com/cx/api.js"],
  "google-analytics_ga.js": ["google-analytics.com/ga.js"],
  "google-analytics_inpage_linkid.js": ["google-analytics.com/inpage_linkid.js"],
  "google-ima.js": ["google-ima3"],
  "googlesyndication_adsbygoogle.js": ["googlesyndication.com/adsbygoogle.js", "googlesyndication-adsbygoogle"],
  "googletagservices_gpt.js": ["googletagservices.com/gpt.js", "googletagservices-gpt"],
  "hd-main.js": [],
  "nitropay_ads.js": [],
  "nobab2.js": [],
  "noeval.js": [],
  "noeval-silent.js": ["silent-noeval.js"],
  "nofab.js": ["fuckadblock.js-3.2.0"],
  "noop-0.1s.mp3": ["noopmp3-0.1s", "abp-resource:blank-mp3"],
  "noop-0.5s.mp3": [],
  "noop-1s.mp4": ["noopmp4-1s", "abp-resource:blank-mp4"],
  "noop.css": [],
  "noop.html": ["noopframe"],
  "noop.js": ["noopjs", "abp-resource:blank-js"],
  "noop.json": ["noopjson"],
  "noop.txt": ["nooptext"],
  "noop-vast2.xml": ["noopvast-2.0"],
  "noop-vast3.xml": ["noopvast-3.0"],
  "noop-vast4.xml": ["noopvast-4.0"],
  "noop-vmap1.xml": ["noopvmap-1.0"],
  "outbrain-widget.js": ["widgets.outbrain.com/outbrain.js"],
  "piano-analytics.js": [],
  "popads.js": ["popads.net.js"],
  "popads-dummy.js": [],
  "prebid-ads.js": [],
  "scorecardresearch_beacon.js": ["scorecardresearch.com/beacon.js"],
  "sensors-analytics.js": [],
};
export const RESOURCE_PATH = "/rules/resources/";
const RESOURCE_BY_NAME = new Map(Object.entries(REDIRECT_RESOURCES).flatMap(([file, aliases]) => [[file, file], ...aliases.map((alias) => [alias, file])]));

/** Request types a stand-in can replace, for filters that name none. */
function resourceTypesOf(file) {
  if (file.endsWith(".js")) return ["script"];
  if (/\.(gif|png)$/.test(file)) return ["image"];
  if (/\.(mp3|mp4)$/.test(file)) return ["media"];
  if (file.endsWith(".html")) return ["sub_frame"];
  if (file.endsWith(".css")) return ["stylesheet"];
  return ["xmlhttprequest", "other"];
}

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

/** A domain in a rule option. Rule conditions also take a bare top-level domain such as "gov". */
function optionDomain(raw) {
  const text = raw.trim().toLowerCase();
  if (/^[a-z]{2,}$/.test(text)) return text;
  return normalizeDomain(text);
}

function parseDomainOption(value, out) {
  for (const part of value.split("|")) {
    const negated = part.startsWith("~");
    const domain = optionDomain(negated ? part.slice(1) : part);
    if (!domain) return false;
    (negated ? out.excludedInitiatorDomains : out.initiatorDomains).push(domain);
  }
  return true;
}

/** Returns the rule's condition fields and flags, or null when any option has no exact equivalent. */
function parseOptions(text) {
  const parsed = { types: [], excludedTypes: [], initiatorDomains: [], excludedInitiatorDomains: [], requestDomains: [], excludedRequestDomains: [], methods: [], domainType: null, caseSensitive: false, important: false, badfilter: false };
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
    } else if (name === "to") {
      for (const part of value.split("|")) {
        const negatedPart = part.startsWith("~");
        const domain = optionDomain(negatedPart ? part.slice(1) : part);
        if (!domain) return null;
        (negatedPart ? parsed.excludedRequestDomains : parsed.requestDomains).push(domain);
      }
    } else if (name === "badfilter") {
      parsed.badfilter = true;
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
    } else if ((name === "redirect" || name === "redirect-rule") && !negated) {
      // A trailing ":<number>" is uBlock Origin's redirect priority, which the rule engine has no use for.
      const file = RESOURCE_BY_NAME.get(value.replace(/:-?\d+$/, ""));
      if (!file) return null;
      parsed.redirect = file;
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
  const options = parseOptions(optionText);
  if (!options) return { skipped: "option" };
  if (allow && options.redirect) return { skipped: "option" };

  if (patternText.startsWith("/") && patternText.endsWith("/") && patternText.length > 2) {
    const regex = patternText.slice(1, -1);
    if (!isPortableRegex(regex)) return { skipped: "regex" };
    return { allow, regex, host: null, options };
  }

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

/** Chromium checks rule regexes with RE2, and one it rejects stops the whole extension from
 * loading. Only plain syntax both engines read the same way is kept: no lookaround or named
 * groups, no backreferences, no repeat count above RE2's 1000, no JavaScript-only escapes. */
export function isPortableRegex(regex) {
  if (regex.length > 500) return false;
  if (/\(\?(?!:)/.test(regex) || /\\[1-9kcupPxX]/.test(regex) || /\[\^?\]/.test(regex) || /\{,/.test(regex)) return false;
  for (const [, low, high] of regex.matchAll(/\{(\d+)(?:,(\d*))?\}/g)) {
    if (Number(low) > 1000 || (high && Number(high) > 1000)) return false;
  }
  try {
    new RegExp(regex);
    return true;
  } catch {
    return false;
  }
}

/** The filter as written, without its badfilter option. */
function badfilterKey(line) {
  const [pattern, options] = splitOptions(line.trim());
  const kept = options.split(",").filter((option) => option && option !== "badfilter");
  return kept.length ? `${pattern}$${kept.join(",")}` : pattern;
}

function conditionFor(parsed) {
  const { options } = parsed;
  const condition = {};
  if (options.domainType) condition.domainType = options.domainType;
  if (options.initiatorDomains.length) condition.initiatorDomains = [...new Set(options.initiatorDomains)].sort();
  if (options.excludedInitiatorDomains.length) condition.excludedInitiatorDomains = [...new Set(options.excludedInitiatorDomains)].sort();
  if (options.requestDomains.length) condition.requestDomains = [...new Set(options.requestDomains)].sort();
  if (options.excludedRequestDomains.length) condition.excludedRequestDomains = [...new Set(options.excludedRequestDomains)].sort();
  if (options.methods.length) condition.requestMethods = [...new Set(options.methods)].sort();
  if (options.types.length) condition.resourceTypes = [...new Set(options.types)].sort();
  else if (options.excludedTypes.length) condition.excludedResourceTypes = [...new Set(options.excludedTypes)].sort();
  return condition;
}

function actionFor(parsed) {
  if (parsed.options.redirect) return "redirect";
  const types = parsed.options.types;
  // An exception for a whole document allows everything in it.
  if (parsed.allow && types.length > 0 && types.every((t) => t === "main_frame")) return "allowAllRequests";
  return parsed.allow ? "allow" : "block";
}

const SHARD_COUNT = 64;
// Syntax that only ad blocker engines understand. CSS alone cannot express these.
const PROCEDURAL = /:(-abp-|has-text|xpath|style|remove|upward|matches-|min-text|contains|if|nth-ancestor|watch-attr|others)|^\+js|^script:|\{|\}/;
const SIMPLE_SELECTOR = /^[.#][\w-]+$|^[\w-]*\[[\w-]+([\^$*|~]?=(".*?"|[\w-]+))?\]$/;
// Declarations for `:style()`: no rule breaks, comments, escapes or URLs that could load anything.
const SAFE_STYLE = /^[^{}\\<>@]*$/;
const UNSAFE_STYLE = /url\(|image-set\(|expression|\/\*/i;

/** Shard of a hostname. The extension uses the same function to find a site's file. */
export function cosmeticShard(host) {
  let value = 0x811c9dc5;
  for (let i = 0; i < host.length; i++) {
    value ^= host.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0) % SHARD_COUNT;
}

/**
 * Compiles element hiding filters. Generic filters with a simple selector become one stylesheet,
 * since browsers look those up by class or ID. Site-specific filters go in shards by hostname.
 */
export function compileCosmetic(texts) {
  const generic = new Set();
  const sites = new Map();
  const stats = { hide: 0, unhide: 0, style: 0, genericSkipped: 0, skipped: 0 };
  const site = (host) => {
    if (!sites.has(host)) sites.set(host, { hide: new Set(), show: new Set(), style: new Map() });
    return sites.get(host);
  };
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      const match = /^([^#]*)#(@?)#(.+)$/.exec(line);
      if (!match || line.startsWith("!")) continue;
      const [, domainList, exception] = match;
      let selector = match[3];
      // `:remove()` takes the element away; hiding it looks the same. `:style()` restyles it.
      const removed = /^(.+?):remove\(\)$/.exec(selector);
      if (removed) selector = removed[1];
      const styled = /^(.+?):style\((.+)\)$/.exec(selector);
      if (styled) {
        const [, base, declarations] = styled;
        const hosts = domainList ? domainList.split(",").map((d) => d.trim().toLowerCase()) : [];
        const included = hosts.filter((d) => !d.startsWith("~")).map(normalizeDomain);
        if (exception || included.length === 0 || included.includes(null) || PROCEDURAL.test(base) || !SAFE_STYLE.test(declarations) || UNSAFE_STYLE.test(declarations) || line.length > 600) {
          stats.skipped++;
          continue;
        }
        for (const host of included) site(host).style.set(base, declarations);
        stats.style++;
        continue;
      }
      if (PROCEDURAL.test(selector) || selector.length > 400) {
        stats.skipped++;
        continue;
      }
      const domains = domainList ? domainList.split(",").map((d) => d.trim().toLowerCase()) : [];
      const included = domains.filter((d) => !d.startsWith("~")).map(normalizeDomain);
      const excluded = domains.filter((d) => d.startsWith("~")).map((d) => normalizeDomain(d.slice(1)));
      if (included.includes(null) || excluded.includes(null)) {
        stats.skipped++;
        continue;
      }
      if (exception) {
        for (const host of included) site(host).show.add(selector);
        stats.unhide++;
      } else if (included.length > 0) {
        for (const host of included) site(host).hide.add(selector);
        for (const host of excluded) site(host).show.add(selector);
        stats.hide++;
      } else if (SIMPLE_SELECTOR.test(selector)) {
        generic.add(selector);
        for (const host of excluded) site(host).show.add(selector);
        stats.hide++;
      } else {
        stats.genericSkipped++;
      }
    }
  }
  const shards = Array.from({ length: SHARD_COUNT }, () => ({}));
  for (const [host, { hide, show, style }] of [...sites].sort(([a], [b]) => a.localeCompare(b))) {
    const entry = {};
    if (hide.size) entry.hide = [...hide].sort();
    if (show.size) entry.show = [...show].sort();
    if (style.size) entry.style = [...style].sort(([a], [b]) => (a < b ? -1 : 1));
    shards[cosmeticShard(host)][host] = entry;
  }
  return { generic: [...generic].sort(), shards, stats };
}

/**
 * Sites where a list turns hiding off: `@@||site^$generichide` (or ghide) keeps the generic
 * stylesheet off the site, `$specifichide` (shide) its own hiding rules, `$elemhide` (ehide) both.
 * Sites that test for ad blockers with decoy ad elements are listed this way.
 */
export function compileHidingExceptions(texts) {
  const generic = new Set();
  const specific = new Set();
  const disabled = new Set();
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      if (raw.trim().startsWith("@@") && /[$,]badfilter(,|$)/.test(raw)) disabled.add(badfilterKey(raw));
    }
  }
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith("@@") || disabled.has(line)) continue;
      const [patternText, optionText] = splitOptions(line.slice(2));
      if (!optionText) continue;
      const options = optionText.split(",");
      if (options.includes("badfilter")) continue;
      const kinds = new Set(options.map((option) => ({ generichide: "generic", ghide: "generic", specifichide: "specific", shide: "specific", elemhide: "both", ehide: "both" })[option]).filter(Boolean));
      if (kinds.size === 0) continue;
      const hosts = [];
      const host = /^\|\|([a-z0-9.-]+\.[a-z0-9-]+)\^?$/i.exec(patternText)?.[1];
      if (host) hosts.push(host.toLowerCase());
      const domains = options.find((option) => option.startsWith("domain="));
      if (domains && (!patternText || patternText === "*")) {
        for (const domain of domains.slice("domain=".length).split("|")) {
          const normalized = domain.startsWith("~") ? null : normalizeDomain(domain);
          if (normalized) hosts.push(normalized);
        }
      }
      for (const name of hosts) {
        if (kinds.has("generic") || kinds.has("both")) generic.add(name);
        if (kinds.has("specific") || kinds.has("both")) specific.add(name);
      }
    }
  }
  return { generic: [...generic].sort(), specific: [...specific].sort() };
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
  const disabled = new Set();
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      if (parseFilter(line)?.options?.badfilter) disabled.add(badfilterKey(line));
    }
  }
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      const parsed = parseFilter(line);
      if (!parsed) continue;
      stats.lines++;
      if (!parsed.skipped && (parsed.options.badfilter || disabled.has(line.trim()))) parsed.skipped = "badfilter";
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
      const redirect = parsed.options.redirect;
      if (redirect) {
        condition.resourceTypes = (condition.resourceTypes ?? resourceTypesOf(redirect)).filter((t) => t !== "main_frame");
        delete condition.excludedResourceTypes;
        if (condition.resourceTypes.length === 0) {
          stats.compiled--;
          stats.skipped.option = (stats.skipped.option ?? 0) + 1;
          continue;
        }
      }
      const priority = redirect ? PRIORITY.redirect : parsed.options.important ? PRIORITY.important : parsed.allow ? PRIORITY.allow : PRIORITY.block;
      if (parsed.host && !parsed.options.caseSensitive) {
        const key = JSON.stringify([type, priority, condition, redirect]);
        if (!groups.has(key)) groups.set(key, { type, priority, condition, redirect, hosts: new Set() });
        groups.get(key).hosts.add(parsed.host);
      } else {
        if (parsed.regex) condition.regexFilter = parsed.regex;
        else if (parsed.pattern) condition.urlFilter = parsed.pattern;
        if (parsed.options.caseSensitive) condition.isUrlFilterCaseSensitive = true;
        single.set(JSON.stringify([type, priority, condition, redirect]), { type, priority, condition, redirect });
      }
    }
  }

  const rules = [];
  // Redirects count as blocks: the page never gets the file it asked for.
  const add = ({ type, priority, condition, redirect }) => {
    const isAllow = type === "allow" || type === "allowAllRequests";
    const action = redirect ? { type, redirect: { extensionPath: RESOURCE_PATH + redirect } } : { type };
    rules.push({ id: isAllow ? firstAllowId++ : firstId++, priority, action, condition });
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

/**
 * Hosts a page may not open in a new tab: those a list blocks as popups, and its ad servers.
 * The rule engine cannot see popups, so the extension checks new tabs against this list.
 * A popup filter limited to some sites keeps those sites. Exceptions remove a host.
 */
export function compilePopups(texts) {
  const everywhere = new Set();
  const scoped = new Map();
  const allowed = new Set();
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line.startsWith("||") && !line.startsWith("@@||")) continue;
      const allow = line.startsWith("@@");
      const [patternText, optionText] = splitOptions(allow ? line.slice(2) : line);
      const host = /^\|\|([a-z0-9.-]+\.[a-z0-9-]+)\^$/i.exec(patternText)?.[1]?.toLowerCase();
      if (!host) continue;
      const options = optionText ? optionText.split(",") : [];
      const names = options.map((option) => option.split("=")[0]);
      const popup = names.includes("popup");
      if (allow) {
        if (popup) allowed.add(host);
        continue;
      }
      const plainAdServer = options.every((option) => option === "third-party" || option === "3p");
      if (!popup && !plainAdServer) continue;
      const domains = options.find((option) => option.startsWith("domain="));
      const known = names.every((name) => ["popup", "third-party", "3p", "domain"].includes(name));
      if (!known) continue;
      if (!domains) {
        everywhere.add(host);
        continue;
      }
      const sites = domains.slice("domain=".length).split("|").filter((site) => !site.startsWith("~")).map(normalizeDomain);
      if (sites.length === 0 || sites.some((site) => !site)) continue;
      scoped.set(host, [...new Set([...(scoped.get(host) ?? []), ...sites])].sort());
    }
  }
  for (const host of allowed) {
    everywhere.delete(host);
    scoped.delete(host);
  }
  for (const host of everywhere) scoped.delete(host);
  return { hosts: [...everywhere].sort(), scoped: Object.fromEntries([...scoped].sort(([a], [b]) => (a < b ? -1 : 1))) };
}

/** Scriptlets Orbit runs (extension/src/sites/scriptlets.ts), by every name lists use for them. */
const SCRIPTLET_NAMES = {
  "set-constant": "set", set: "set",
  "abort-on-property-read": "aopr", aopr: "aopr",
  "abort-on-property-write": "aopw", aopw: "aopw",
  "abort-current-script": "acs", acs: "acs", "abort-current-inline-script": "acs", acis: "acs",
  "abort-on-stack-trace": "aost", aost: "aost",
  "no-window-open-if": "nowoif", nowoif: "nowoif", "window.open-defuser": "nowoif",
  "no-setTimeout-if": "nostif", nostif: "nostif", "setTimeout-defuser": "nostif", "prevent-setTimeout": "nostif",
  "no-setInterval-if": "nosiif", nosiif: "nosiif", "setInterval-defuser": "nosiif", "prevent-setInterval": "nosiif",
  "nano-setInterval-booster": "nano-sib", "nano-sib": "nano-sib",
  "nano-setTimeout-booster": "nano-stb", "nano-stb": "nano-stb",
  "remove-node-text": "rmnt", rmnt: "rmnt",
  "replace-node-text": "rpnt", rpnt: "rpnt",
  "addEventListener-defuser": "aeld", aeld: "aeld", "prevent-addEventListener": "aeld",
  "no-fetch-if": "no-fetch-if", "prevent-fetch": "no-fetch-if",
  "no-xhr-if": "no-xhr-if", "prevent-xhr": "no-xhr-if",
  "noeval-if": "noeval-if", "prevent-eval-if": "noeval-if",
  noeval: "noeval", "silent-noeval": "noeval",
  "json-prune": "json-prune",
  "remove-attr": "ra", ra: "ra",
  "remove-class": "rc", rc: "rc",
  "set-local-storage-item": "set-local-storage-item",
  "set-session-storage-item": "set-session-storage-item",
  "window.name-defuser": "window.name-defuser",
  nofab: "nofab", "fuckadblock.js-3.2.0": "nofab",
  nobab: "nobab", nobab2: "nobab",
  "popads-dummy": "popads-dummy",
  nowebrtc: "nowebrtc",
  "set-cookie": "set-cookie",
  "trusted-set-cookie": "trusted-set-cookie",
  "remove-cookie": "remove-cookie", "cookie-remover": "remove-cookie",
  "json-prune-fetch-response": "json-prune-fetch-response",
  "json-prune-xhr-response": "json-prune-xhr-response",
  "xml-prune": "xml-prune",
  "trusted-set": "trusted-set", "trusted-set-constant": "trusted-set",
  "trusted-replace-argument": "trusted-replace-argument",
  "trusted-rpnt": "rpnt", "trusted-replace-node-text": "rpnt",
  "refresh-defuser": "refresh-defuser",
  "href-sanitizer": "href-sanitizer",
};

/** Splits scriptlet arguments the way uBlock Origin does: on commas not escaped with a backslash,
 * trimmed, with surrounding quotes removed. */
export function scriptletArgs(text) {
  const args = [];
  let i = 0;
  while (i <= text.length) {
    while (text[i] === " ") i++;
    const quote = text[i];
    if (quote === "'" || quote === '"' || quote === "`") {
      const end = text.indexOf(quote, i + 1);
      const after = end === -1 ? -1 : text.slice(end + 1).search(/\S/);
      if (end !== -1 && (after === -1 || text[end + 1 + after] === ",")) {
        args.push(text.slice(i + 1, end));
        i = after === -1 ? text.length + 1 : end + 1 + after + 1;
        continue;
      }
    }
    let current = "";
    for (; i < text.length; i++) {
      if (text[i] === "\\" && text[i + 1] === ",") {
        current += ",";
        i++;
      } else if (text[i] === ",") {
        break;
      } else {
        current += text[i];
      }
    }
    args.push(current.trim());
    i++;
  }
  return args;
}

/** A site key: a hostname, or an entity such as "example.*" (the name under any public suffix). */
function siteKey(raw) {
  const text = raw.trim().toLowerCase();
  if (text.endsWith(".*")) {
    const base = normalizeDomain(`${text.slice(0, -2)}.example`);
    return base ? `${base.slice(0, -".example".length)}.*` : null;
  }
  return normalizeDomain(text);
}

/**
 * Compiles site-specific scriptlet filters (`site##+js(name, args)`). Generic ones, without sites,
 * are left out: they would run on every page. Exceptions (`site#@#+js(...)`) and negated sites
 * turn a call off for that site; an empty exception turns all of them off.
 */
export function compileScriptlets(texts) {
  const calls = [];
  const callIndex = new Map();
  const sites = new Map();
  const except = new Map();
  const stats = { compiled: 0, unsupported: 0, generic: 0, skipped: 0 };
  const indexOf = (call) => {
    const key = JSON.stringify(call);
    if (!callIndex.has(key)) {
      callIndex.set(key, calls.length);
      calls.push(call);
    }
    return callIndex.get(key);
  };
  const add = (map, key, value) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(value);
  };
  const exceptions = [];
  for (const text of texts) {
    for (const raw of text.split(/\r?\n/)) {
      const match = /^([^#!][^#]*)?#(@?)#\+js\((.*)\)$/.exec(raw.trim());
      if (!match) continue;
      const [, siteList = "", exception, body] = match;
      const domains = siteList ? siteList.split(",").map((d) => d.trim()).filter(Boolean) : [];
      if (exception) {
        exceptions.push({ domains, body });
        continue;
      }
      if (domains.length === 0) {
        stats.generic++;
        continue;
      }
      const [rawName, ...args] = scriptletArgs(body);
      const name = SCRIPTLET_NAMES[rawName.replace(/\.js$/, "")];
      if (!name) {
        stats.unsupported++;
        continue;
      }
      const included = domains.filter((d) => !d.startsWith("~")).map(siteKey);
      const excluded = domains.filter((d) => d.startsWith("~")).map((d) => siteKey(d.slice(1)));
      if (included.length === 0 || included.includes(null) || excluded.includes(null)) {
        stats.skipped++;
        continue;
      }
      const index = indexOf([name, ...args]);
      for (const site of included) add(sites, site, index);
      for (const site of excluded) add(except, site, index);
      stats.compiled++;
    }
  }
  for (const { domains, body } of exceptions) {
    const keys = domains.map(siteKey).filter(Boolean);
    if (body.trim() === "") {
      for (const key of keys) add(except, key, -1);
      continue;
    }
    const [rawName, ...args] = scriptletArgs(body);
    const name = SCRIPTLET_NAMES[rawName.replace(/\.js$/, "")];
    const index = name ? callIndex.get(JSON.stringify([name, ...args])) : undefined;
    if (index === undefined) continue;
    for (const key of keys) add(except, key, index);
  }
  const sorted = (map) => Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, set]) => [key, [...set].sort((a, b) => a - b)]));
  return { calls, sites: sorted(sites), except: sorted(except), stats };
}
