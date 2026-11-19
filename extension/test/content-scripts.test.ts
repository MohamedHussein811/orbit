import assert from "node:assert/strict";
import { test } from "node:test";
import { planScripts, sameScript, type ScriptSpec } from "../src/shared/content-scripts.ts";

const shard = (id: string, matches: string[], excludeMatches: string[] = []): ScriptSpec => ({
  id,
  js: [`rules/scriptlets/${id}.js`],
  matches,
  excludeMatches,
  allFrames: true,
  runAt: "document_start",
  world: "MAIN",
});

test("unchanged scripts are left registered", () => {
  const wanted = [shard("a", ["*://*.a.com/*", "*://*.b.com/*"]), shard("b", ["*://*.c.com/*"])];
  const registered = [shard("b", ["*://*.c.com/*"]), shard("a", ["*://*.b.com/*", "*://*.a.com/*"])];
  assert.deepEqual(planScripts(registered, wanted, () => true), { unregister: [], register: [] });
});

test("defaults the browser fills in count as equal", () => {
  const wanted: ScriptSpec = { id: "css", css: ["x.css"], matches: ["https://*/*"] };
  const registered: ScriptSpec = { ...wanted, excludeMatches: [], allFrames: false, matchOriginAsFallback: false, runAt: "document_idle", world: "ISOLATED" };
  assert.equal(sameScript(registered, wanted), true);
});

test("only changed, new and removed scripts are touched", () => {
  const registered = [shard("keep", ["*://*.k.com/*"]), shard("change", ["*://*.c.com/*"]), shard("gone", ["*://*.g.com/*"])];
  const wanted = [shard("keep", ["*://*.k.com/*"]), shard("change", ["*://*.c.com/*"], ["*://off.com/*"]), shard("new", ["*://*.n.com/*"])];
  const plan = planScripts(registered, wanted, () => true);
  assert.deepEqual(plan.unregister.sort(), ["change", "gone"]);
  assert.deepEqual(plan.register.map((script) => script.id), ["change", "new"]);
});

test("scripts outside the owner are never unregistered", () => {
  const plan = planScripts([shard("other", ["*://*.o.com/*"])], [], (id) => id.startsWith("orbit-"));
  assert.deepEqual(plan, { unregister: [], register: [] });
});

test("file order matters, pattern order does not", () => {
  assert.equal(sameScript({ id: "x", js: ["a.js", "b.js"] }, { id: "x", js: ["b.js", "a.js"] }), false);
  assert.equal(sameScript({ id: "x", matches: ["a", "b"] }, { id: "x", matches: ["b", "a"] }), true);
});
