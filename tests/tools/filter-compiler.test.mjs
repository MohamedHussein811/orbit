import assert from "node:assert/strict";
import { test } from "node:test";
import { ALLOW_ID_BASE, compileCosmetic, compileFilters, compileHosts, cosmeticShard, parseFilter } from "../../tools/filter-compiler.mjs";

const one = (line) => {
  const { rules } = compileFilters([line]);
  assert.equal(rules.length, 1, line);
  return rules[0];
};

test("comments and blank lines produce nothing", () => {
  assert.equal(parseFilter("! comment"), null);
  assert.equal(parseFilter("[Adblock Plus 2.0]"), null);
  assert.equal(parseFilter("   "), null);
});

test("cosmetic filters are skipped and counted", () => {
  const { rules, stats } = compileFilters(["example.com##.ad", "###banner", "example.org#@#.ad", "foo.com#?#div:has(a)"]);
  assert.deepEqual(rules, []);
  assert.equal(stats.skipped.cosmetic, 4);
});

test("a plain hostname filter becomes a domain rule", () => {
  const rule = one("||tracker.example^");
  assert.deepEqual(rule.condition.requestDomains, ["tracker.example"]);
  assert.equal(rule.condition.urlFilter, undefined);
  assert.deepEqual(rule.action, { type: "block" });
});

test("hostname filters with the same options merge into one rule", () => {
  const { rules } = compileFilters(["||a.example^", "||b.example^", "||c.example^$third-party"]);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0].condition.requestDomains, ["a.example", "b.example"]);
  assert.deepEqual(rules[1].condition.requestDomains, ["c.example"]);
  assert.equal(rules[1].condition.domainType, "thirdParty");
});

test("a path filter keeps its pattern", () => {
  const rule = one("||cdn.example/ads/*.js$script");
  assert.equal(rule.condition.urlFilter, "||cdn.example/ads/*.js");
  assert.deepEqual(rule.condition.resourceTypes, ["script"]);
});

test("options map to conditions", () => {
  const rule = one("/banner/ad.$image,third-party,domain=a.example|~b.a.example,match-case");
  assert.deepEqual(rule.condition.resourceTypes, ["image"]);
  assert.equal(rule.condition.domainType, "thirdParty");
  assert.deepEqual(rule.condition.initiatorDomains, ["a.example"]);
  assert.deepEqual(rule.condition.excludedInitiatorDomains, ["b.a.example"]);
  assert.equal(rule.condition.isUrlFilterCaseSensitive, true);
});

test("negated types become excluded types", () => {
  const rule = one("||x.example/y$~script,~image");
  assert.deepEqual(rule.condition.excludedResourceTypes, ["image", "script"]);
  assert.equal(rule.condition.resourceTypes, undefined);
});

test("exceptions get a higher priority and their own ID range", () => {
  const rule = one("@@||good.example/lib.js$script");
  assert.deepEqual(rule.action, { type: "allow" });
  assert.ok(rule.id >= ALLOW_ID_BASE);
  assert.ok(rule.priority > one("||bad.example/x").priority);
});

test("a document exception allows the whole page", () => {
  const rule = one("@@||good.example^$document");
  assert.deepEqual(rule.action, { type: "allowAllRequests" });
  assert.deepEqual(rule.condition.resourceTypes, ["main_frame", "sub_frame"]);
});

test("$all also blocks page loads", () => {
  const rule = one("||malware.example^$all");
  assert.ok(rule.condition.resourceTypes.includes("main_frame"));
  assert.ok(rule.condition.resourceTypes.includes("script"));
});

test("$document on a block rule blocks the page", () => {
  const rule = one("||phish.example^$document");
  assert.deepEqual(rule.condition.resourceTypes, ["main_frame"]);
});

test("filters with no exact equivalent are skipped, not approximated", () => {
  for (const line of ["||x.example^$csp=script-src 'none'", "||x.example^$redirect=noop.js", "||x.example^$removeparam=utm", "||x.example^$popup", "/regex[0-9]+/", "||x.example^$domain=a.*"]) {
    const { rules, stats } = compileFilters([line]);
    assert.deepEqual(rules, [], line);
    assert.equal(stats.compiled, 0, line);
  }
});

test("a popup type mixed with others keeps the others", () => {
  const rule = one("||x.example/a$script,popup");
  assert.deepEqual(rule.condition.resourceTypes, ["script"]);
});

test("overly short patterns are refused unless scoped to a site", () => {
  assert.deepEqual(compileFilters(["ad"]).rules, []);
  assert.equal(compileFilters(["ad$domain=a.example"]).rules.length, 1);
});

test("non-ASCII patterns are skipped, and non-ASCII scope domains become punycode", () => {
  assert.deepEqual(compileFilters(["||пример.example/x"]).rules, []);
  const rule = one("/ad.js$domain=пример.рф");
  assert.deepEqual(rule.condition.initiatorDomains, ["xn--e1afmkfd.xn--p1ai"]);
});

test("duplicates compile to one rule", () => {
  assert.equal(compileFilters(["||x.example/a", "||x.example/a"]).rules.length, 1);
});

test("IDs are unique", () => {
  const { rules } = compileFilters(["||a.example/x", "||b.example/x", "@@||c.example/x", "@@||d.example/x", "||e.example^"]);
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length);
});

test("threat lists send page loads to the warning page and block the rest", () => {
  const { rules, stats } = compileHosts(["! comment\nbad.example\nBAD2.example\nhacked.example/path/file.exe\n"], { redirect: "chrome-extension://x/blocked.html" });
  assert.equal(stats.compiled, 2);
  assert.equal(stats.skipped.path, 1);
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[0].condition.requestDomains, ["bad.example", "bad2.example"]);
  assert.equal(rules[0].action.redirect.regexSubstitution, "chrome-extension://x/blocked.html#\\0");
  assert.deepEqual(rules[0].condition.resourceTypes, ["main_frame"]);
  assert.deepEqual(rules[1].action, { type: "block" });
  assert.deepEqual(rules[1].condition.excludedResourceTypes, ["main_frame"]);
});

test("generic hiding keeps simple selectors only", () => {
  const { generic, stats } = compileCosmetic(["##.ad-banner\n###top-ad\n##div[data-ad]\n##div > .x .y\n"]);
  assert.deepEqual(generic, ["#top-ad", ".ad-banner", "div[data-ad]"]);
  assert.equal(stats.genericSkipped, 1);
});

test("site hiding goes to the site's shard", () => {
  const { shards } = compileCosmetic(["a.example,b.example##.x > .y\n"]);
  assert.deepEqual(shards[cosmeticShard("a.example")]["a.example"], { hide: [".x > .y"] });
  assert.deepEqual(shards[cosmeticShard("b.example")]["b.example"], { hide: [".x > .y"] });
});

test("exceptions and excluded sites show the element again", () => {
  const { shards, generic } = compileCosmetic(["~c.example##.ad\nd.example#@#.ad\n"]);
  assert.deepEqual(generic, [".ad"]);
  assert.deepEqual(shards[cosmeticShard("c.example")]["c.example"], { show: [".ad"] });
  assert.deepEqual(shards[cosmeticShard("d.example")]["d.example"], { show: [".ad"] });
});

test("syntax CSS cannot express is skipped", () => {
  const { generic, shards, stats } = compileCosmetic(["##.a:has-text(x)\nb.example##+js(nowebrtc)\nc.example##.d:style(color:red)\ne.example##.f{}\n"]);
  assert.deepEqual(generic, []);
  assert.deepEqual(shards.flatMap((s) => Object.keys(s)), []);
  assert.equal(stats.skipped, 4);
});

test("network filters are not read as hiding filters", () => {
  const { generic, shards } = compileCosmetic(["||ads.example^\n! ##.comment\n"]);
  assert.deepEqual(generic, []);
  assert.deepEqual(shards.flatMap((s) => Object.keys(s)), []);
});

test("a dollar sign inside a URL is not read as options", () => {
  const rule = one("||x.example/a$b/c.js");
  assert.equal(rule.condition.urlFilter, "||x.example/a$b/c.js");
});
