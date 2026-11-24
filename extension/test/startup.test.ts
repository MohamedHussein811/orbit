import assert from "node:assert/strict";
import { test } from "node:test";
import { planStartup } from "../src/shared/startup.ts";

const NTP = "chrome-extension://orbit/newtab/";

test("specific pages open once each, the first in front", () => {
  const steps = planStartup({ mode: "pages", urls: ["https://a.example/", "https://b.example/x"] }, [{ id: 1, url: "https://other.example/" }], NTP);
  assert.deepEqual(steps, [
    { open: "https://a.example/", active: true },
    { open: "https://b.example/x", active: false },
  ]);
});

test("pages already open are reused, even after a redirect to https or www", () => {
  const tabs = [
    { id: 4, url: "https://www.a.example/" },
    { id: 5, url: "https://b.example/x" },
  ];
  assert.deepEqual(planStartup({ mode: "pages", urls: ["http://a.example", "https://b.example/x"] }, tabs, NTP), [{ activate: 4, active: true }]);
  assert.deepEqual(planStartup({ mode: "pages", urls: ["https://c.example/", "https://b.example/x"] }, tabs, NTP), [{ open: "https://c.example/", active: true }]);
});

test("private tabs never count as open, duplicates and bad addresses are skipped", () => {
  const steps = planStartup({ mode: "pages", urls: ["https://a.example/", "https://a.example", "javascript:alert(1)"] }, [{ id: 2, url: "https://a.example/", incognito: true }], NTP);
  assert.deepEqual(steps, [{ open: "https://a.example/", active: true }]);
});

test("new tab page mode brings one to front, restore mode does nothing", () => {
  assert.deepEqual(planStartup({ mode: "newTab", urls: [] }, [{ id: 3, url: `${NTP}newtab.html` }], NTP), [{ activate: 3, active: true }]);
  assert.deepEqual(planStartup({ mode: "newTab", urls: [] }, [{ id: 3, url: "https://a.example/" }], NTP), [{ open: "chrome://newtab/", active: true }]);
  assert.deepEqual(planStartup({ mode: "restore", urls: ["https://a.example/"] }, [], NTP), []);
});
