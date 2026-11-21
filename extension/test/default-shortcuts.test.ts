import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { bundledIconPath, DEFAULT_SHORTCUTS, seedDefaultShortcuts } from "../src/shared/default-shortcuts.ts";

interface Created {
  parentId?: string;
  title?: string;
  url?: string;
}

// Desktop lists the bookmarks bar ("1"), other bookmarks and mobile bookmarks; Android hides an
// empty bookmarks bar from extensions and lists only mobile bookmarks ("3").
function fakeChrome(barChildren: number, storage: Record<string, unknown> = {}, roots = ["1", "2", "3"]) {
  const created: Created[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    storage: {
      local: {
        get: async (key: string) => ({ [key]: storage[key] }),
        set: async (values: Record<string, unknown>) => Object.assign(storage, values),
      },
    },
    bookmarks: {
      getTree: async () => [{ id: "0", children: roots.map((id) => ({ id, title: id, children: [] })) }],
      getChildren: async (id: string) => {
        if (!roots.includes(id)) throw new Error("Can't find bookmark for id.");
        return Array.from({ length: barChildren }, (_, i) => ({ id: String(10 + i) }));
      },
      create: async (bookmark: Created) => created.push(bookmark),
    },
  };
  return { created, storage };
}

test("on Android the default shortcuts go to mobile bookmarks", async () => {
  const { created } = fakeChrome(0, {}, ["3"]);
  assert.equal(await seedDefaultShortcuts(), true);
  assert.equal(created.length, DEFAULT_SHORTCUTS.length);
  assert.ok(created.every((item) => item.parentId === "3"));
});

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

test("a failed attempt can be tried again", async () => {
  const { storage } = fakeChrome(0);
  const chrome = (globalThis as unknown as { chrome: { bookmarks: { create: () => Promise<never> } } }).chrome;
  chrome.bookmarks.create = async () => {
    throw new Error("model not ready");
  };
  await assert.rejects(seedDefaultShortcuts());
  assert.equal(storage.shortcutsSeeded, false);
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
