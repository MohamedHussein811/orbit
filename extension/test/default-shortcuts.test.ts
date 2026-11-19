import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { bundledIconPath, DEFAULT_SHORTCUTS, seedDefaultShortcuts } from "../src/shared/default-shortcuts.ts";

interface Created {
  parentId?: string;
  title?: string;
  url?: string;
}

function fakeChrome(barChildren: number, storage: Record<string, unknown> = {}) {
  const created: Created[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storage[key] }),
        set: async (values: Record<string, unknown>) => Object.assign(storage, values),
      },
    },
    bookmarks: {
      getChildren: async () => Array.from({ length: barChildren }, (_, i) => ({ id: String(10 + i) })),
      create: async (bookmark: Created) => created.push(bookmark),
    },
  };
  return { created, storage };
}

test("an empty bookmarks bar gets the default shortcuts, in order, once", async () => {
  const { created, storage } = fakeChrome(0);
  assert.equal(await seedDefaultShortcuts(), true);
  assert.deepEqual(
    created.map((item) => item.title),
    DEFAULT_SHORTCUTS.map((site) => site.title),
  );
  assert.ok(created.every((item) => item.parentId === "1"));
  assert.equal(storage.shortcutsSeeded, true);
  assert.equal(await seedDefaultShortcuts(), false);
  assert.equal(created.length, DEFAULT_SHORTCUTS.length);
});

test("a bookmarks bar with the person's own bookmarks is left alone", async () => {
  const { created, storage } = fakeChrome(3);
  assert.equal(await seedDefaultShortcuts(), false);
  assert.equal(created.length, 0);
  assert.equal(storage.shortcutsSeeded, true);
});

test("every default shortcut has a bundled icon file", () => {
  for (const site of DEFAULT_SHORTCUTS) {
    const icon = bundledIconPath(site.url);
    assert.ok(icon, site.url);
    assert.ok(fs.existsSync(new URL(`../src${icon}`, import.meta.url)), icon);
    assert.equal(bundledIconPath(`${site.url}some/page?q=1`), icon);
  }
  assert.equal(bundledIconPath("https://example.com/"), null);
  assert.equal(bundledIconPath("not a url"), null);
});
