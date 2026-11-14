import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { contrastReport, generated } from "../../tools/design/tokens.mjs";

test("every token pair meets WCAG AA contrast", () => {
  const failing = contrastReport().filter((row) => !row.ok);
  assert.deepEqual(failing, []);
});

test("generated palette, CSS and contrast table are current", () => {
  for (const [file, content] of generated()) {
    assert.equal(fs.readFileSync(file, "utf8"), content, `${file} is out of date: node tools/design/tokens.mjs write`);
  }
});
