import assert from "node:assert/strict";
import { test } from "node:test";
import { ALLOW_ID_BASE, compileCosmetic, compileFilters, compileHidingExceptions, compileHosts, compilePopups, compileScriptlets, cosmeticShard, isPortableRegex, parseFilter, scriptletArgs } from "../../tools/filter-compiler.mjs";
import { preprocess } from "../../tools/filters.mjs";

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
  for (const line of ["||x.example^$csp=script-src 'none'", "||x.example^$redirect=unknown-resource.js", "@@||x.example^$redirect=noop.js", "||x.example^$removeparam=utm", "||x.example^$popup", "/(?=x)regex[0-9]+/", "/a{2000}/", "||x.example^$domain=a.*"]) {
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
  const { generic, shards, stats } = compileCosmetic(["##.a:has-text(x)\nb.example##+js(nowebrtc)\nc.example##.d:upward(2)\ne.example##.f{}\n"]);
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

test("popup hosts come from popup filters and plain ad servers, minus exceptions", () => {
  const list = [
    "||pop.example^$popup",
    "||ads.example^",
    "||tp.example^$third-party",
    "||site-only.example^$popup,domain=movies.example|~good.example",
    "||script.example^$script",
    "||path.example/ad.js$popup",
    "||allowed.example^$popup",
    "@@||allowed.example^$popup",
    "! ||comment.example^",
  ].join("\n");
  const { hosts, scoped } = compilePopups([list]);
  assert.deepEqual(hosts, ["ads.example", "pop.example", "tp.example"]);
  assert.deepEqual(scoped, { "site-only.example": ["movies.example"] });
});

test("regex filters RE2 can read become regex rules", () => {
  const rule = one(String.raw`/^https:\/\/[a-z]{8}\.com\/\d+$/$script,3p`);
  assert.equal(rule.condition.regexFilter, String.raw`^https:\/\/[a-z]{8}\.com\/\d+$`);
  assert.deepEqual(rule.condition.resourceTypes, ["script"]);
  assert.equal(isPortableRegex("a(?!b)"), false);
  assert.equal(isPortableRegex(String.raw`(a)\1`), false);
  assert.equal(isPortableRegex("a{1,1001}"), false);
  assert.equal(isPortableRegex("(?:ab)+[0-9]{3,6}"), true);
});

test("badfilter turns off the filter it names", () => {
  const { rules, stats } = compileFilters(["||ads.example^$script", "||ads.example^$script,badfilter", "||other.example^"]);
  assert.equal(rules.length, 1);
  assert.deepEqual(rules[0].condition.requestDomains, ["other.example"]);
  assert.equal(stats.skipped.badfilter, 2);
});

test("to= limits the request domains, top-level domains included", () => {
  const rule = one("/ad.js$to=~gov|example.com");
  assert.deepEqual(rule.condition.requestDomains, ["example.com"]);
  assert.deepEqual(rule.condition.excludedRequestDomains, ["gov"]);
});

test("scriptlet arguments split like uBlock Origin", () => {
  assert.deepEqual(scriptletArgs("acs, document.write, 'a, b'"), ["acs", "document.write", "a, b"]);
  assert.deepEqual(scriptletArgs(String.raw`rmnt, script, a\,b`), ["rmnt", "script", "a,b"]);
});

test("site scriptlets compile by host and entity, with exceptions", () => {
  const { calls, sites, except, stats } = compileScriptlets([
    "example.com,movies.*##+js(nowoif)",
    "example.com,~sub.example.com##+js(set-constant, ads, false)",
    "##+js(nowoif)",
    "example.com##+js(unknown-scriptlet)",
    "example.com#@#+js(nowoif)",
  ]);
  assert.deepEqual(calls, [["nowoif"], ["set", "ads", "false"]]);
  assert.deepEqual(sites, { "example.com": [0, 1], "movies.*": [0] });
  assert.deepEqual(except, { "example.com": [0], "sub.example.com": [1] });
  assert.equal(stats.generic, 1);
  assert.equal(stats.unsupported, 1);
});

test("preprocessing keeps blocks that hold for Orbit and lookahead-free Safari network rules", () => {
  const text = ["a", "!#if env_firefox", "b", "!#else", "c", "!#endif", "!#if env_mobile", "d", "!#endif", "!#if !env_mobile", "e", "!#endif", "!#if env_safari", "/x[0-9]/$script", "!#endif", "!#if env_safari", "example.com##.ad", "!#endif"].join("\n");
  assert.deepEqual(preprocess(text).split("\n"), ["a", "c", "e", "/x[0-9]/$script"]);
});

test("redirect filters load a harmless stand-in instead of the blocked file", () => {
  const rule = one("||ads.example/ad.js$script,redirect=noopjs");
  assert.deepEqual(rule.action, { type: "redirect", redirect: { extensionPath: "/rules/resources/noop.js" } });
  assert.deepEqual(rule.condition.resourceTypes, ["script"]);
  assert.ok(rule.id < ALLOW_ID_BASE);
  assert.ok(rule.priority > one("||ads.example/ad.js$script").priority);
  assert.equal(rule.priority, one("@@||ads.example/ad.js$script").priority);
});

test("redirect names resolve through their aliases, priorities are dropped, types follow the stand-in", () => {
  assert.equal(one("||imasdk.googleapis.com/js/sdkloader/ima3.js$redirect-rule=google-ima3:5").action.redirect.extensionPath, "/rules/resources/google-ima.js");
  const image = one("||ads.example/pixel$redirect=1x1.gif,domain=a.example");
  assert.deepEqual(image.condition.resourceTypes, ["image"]);
  assert.deepEqual(image.condition.initiatorDomains, ["a.example"]);
  assert.deepEqual(one("||ads.example^$xhr,redirect=nooptext").condition.resourceTypes, ["xmlhttprequest"]);
  assert.deepEqual(compileFilters(["||ads.example^$document,redirect=noopjs"]).rules, []);
});

test("generichide and elemhide exceptions name the sites that keep hiding off", () => {
  const list = [
    "@@||decoy.example^$ghide",
    "@@||b.example^$generichide",
    "@@||b.example^$generichide,badfilter",
    "@@||c.example^$elemhide",
    "@@||d.example^$specifichide",
    "@@*$ghide,domain=e.example|~f.example",
    "@@||g.example^$script",
  ].join("\n");
  const { generic, specific } = compileHidingExceptions([list]);
  assert.deepEqual(generic, ["c.example", "decoy.example", "e.example"]);
  assert.deepEqual(specific, ["c.example", "d.example"]);
});

test(":style() restyles on its sites, :remove() hides, unsafe styles are refused", () => {
  const list = [
    "a.example##.overlay:style(position: static !important; z-index: 1)",
    "a.example##.wall:remove()",
    "a.example##.x:style(background: url(https://t.example/p))",
    "##.y:style(color: red)",
  ].join("\n");
  const { shards, stats } = compileCosmetic([list]);
  const entry = shards[cosmeticShard("a.example")]["a.example"];
  assert.deepEqual(entry.style, [[".overlay", "position: static !important; z-index: 1"]]);
  assert.deepEqual(entry.hide, [".wall"]);
  assert.equal(stats.style, 1);
  assert.equal(stats.skipped, 2);
});
