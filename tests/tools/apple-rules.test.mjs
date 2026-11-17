import assert from "node:assert/strict";
import { test } from "node:test";
import { convertRule, convertRuleSets, urlFilterRegex, LIST_SIZE } from "../../tools/apple-rules.mjs";

const block = (condition, extra = {}) => ({ id: 1, priority: 1, action: { type: "block" }, condition, ...extra });

test("urlFilter anchors and wildcards become WebKit regex", () => {
  assert.equal(urlFilterRegex("||ads.example.com^"), "^[^:]+://+([^:/]+\\.)?ads\\.example\\.com[^a-zA-Z0-9_.%-]");
  assert.equal(urlFilterRegex("|https://x.test/a?b|"), "^https://x\\.test/a\\?b$");
  assert.equal(urlFilterRegex("/banner/*/ad.js"), "/banner/.*/ad\\.js");
  assert.equal(urlFilterRegex("*"), ".*");
});

test("request host lists become one rule per host", () => {
  const { rules } = convertRule(block({ requestDomains: ["a.test", "b.test"], domainType: "thirdParty" }));
  assert.equal(rules.length, 2);
  assert.deepEqual(rules[1], {
    trigger: { "url-filter": "^[^:]+://+([^:/]+\\.)?b\\.test[:/]", "load-type": ["third-party"] },
    action: { type: "block" },
  });
});

test("initiator domains include subdomains", () => {
  const { rules } = convertRule(block({ urlFilter: "/ad.js", initiatorDomains: ["site.test"] }));
  assert.deepEqual(rules[0].trigger["if-domain"], ["*site.test"]);
  const { rules: unless } = convertRule(block({ urlFilter: "/ad.js", excludedInitiatorDomains: ["site.test"] }));
  assert.deepEqual(unless[0].trigger["unless-domain"], ["*site.test"]);
});

test("main_frame without sub_frame uses a top-frame load context", () => {
  const { rules } = convertRule(block({ requestDomains: ["bad.test"], resourceTypes: ["main_frame", "script"] }));
  assert.deepEqual(rules.map((r) => [r.trigger["resource-type"], r.trigger["load-context"]]), [
    [["script"], undefined],
    [["document"], ["top-frame"]],
  ]);
});

test("excluded types become the remaining WebKit types", () => {
  const { rules } = convertRule(block({ urlFilter: "/x", excludedResourceTypes: ["main_frame", "sub_frame"] }));
  assert.equal(rules.length, 1);
  assert.ok(!rules[0].trigger["resource-type"].includes("document"));
  assert.ok(rules[0].trigger["resource-type"].includes("script"));
});

test("rules WebKit cannot express are skipped, not approximated", () => {
  assert.equal(convertRule(block({ regexFilter: "^https?://" })).skipped, "regex");
  assert.equal(convertRule(block({ urlFilter: "/x", requestMethods: ["post"] })).skipped, "method");
  assert.equal(convertRule(block({ urlFilter: "/x", initiatorDomains: ["a.test"], excludedInitiatorDomains: ["b.a.test"] })).skipped, "if-and-unless-domain");
  const pageAllow = { id: 2, priority: 2, action: { type: "allowAllRequests" }, condition: { urlFilter: "|https://a.test/page" } };
  assert.equal(convertRule(pageAllow).skipped, "allow-all");
});

test("a whole-site exception allows everything its pages load", () => {
  const rule = { id: 2, priority: 2, action: { type: "allowAllRequests" }, condition: { urlFilter: "||shop.test^", resourceTypes: ["main_frame", "sub_frame"] } };
  assert.deepEqual(convertRule(rule).rules, [{ trigger: { "url-filter": ".*", "if-domain": ["*shop.test"] }, action: { type: "ignore-previous-rules" } }]);
});

test("every list ends with all exceptions, then the important blocks", () => {
  const hosts = Array.from({ length: LIST_SIZE + 10 }, (_, i) => `h${i}.test`);
  const allow = { id: 3, priority: 2, action: { type: "allow" }, condition: { urlFilter: "||ok.test^" } };
  const important = block({ urlFilter: "||must.test^" }, { priority: 3 });
  const { lists, stats } = convertRuleSets([[block({ requestDomains: hosts }), allow, important]]);
  assert.equal(lists.length, 2);
  for (const list of lists) {
    assert.ok(list.length <= LIST_SIZE);
    assert.equal(list.at(-2).action.type, "ignore-previous-rules");
    assert.match(list.at(-1).trigger["url-filter"], /must/);
  }
  assert.equal(stats.output, hosts.length + 2);
});

test("important blocks with no exceptions join the normal blocks", () => {
  const { lists } = convertRuleSets([[block({ requestDomains: ["a.test"] }, { priority: 3 })]]);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].length, 1);
});
