// End-to-end checks of the built-in extension on the built host, with the real rule files.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { startFixture } from "./lib/fixture.mjs";
import { binaryPath, launchHost, pref, profilePreferences, removeProfile, securePreferences, sleep, tempProfile, waitForExit } from "./lib/host.mjs";

const EXTENSION_ID = "boccmnigbogdpajphlpgodcalflpinmk";
const COUNT_DELAY_MS = 1500;
function extensionDir() {
  const binary = binaryPath("orbit_test");
  return process.platform === "darwin" ? path.join(path.dirname(binary), "..", "Resources", "orbit-core") : path.join(path.dirname(binary), "orbit-core");
}

const readRules = (name) => JSON.parse(fs.readFileSync(path.join(extensionDir(), "rules", `${name}.json`), "utf8"));

/** A host the real rules block everywhere, with no exception that mentions it. */
function plainlyBlockedHost(name) {
  const rules = readRules(name);
  const exceptions = JSON.stringify(rules.filter((rule) => rule.action.type !== "block"));
  const plain = rules.find((rule) => rule.action.type === "block" && rule.condition.requestDomains && Object.keys(rule.condition).length === 1);
  const host = plain?.condition.requestDomains.find((candidate) => !exceptions.includes(candidate));
  assert.ok(host, `no plain host in ${name}`);
  return host;
}
const AD_HOST = plainlyBlockedHost("ads");
const TRACKER_HOST = plainlyBlockedHost("trackers");

async function dashboard(session) {
  for (let i = 0; i < 40; i++) {
    const target = (await session.pages()).find((t) => t.url === "chrome://newtab/");
    if (target) {
      const page = await session.cdp.page(target.targetId);
      const href = await page.eval("location.href").catch(() => "");
      if (href.startsWith(`chrome-extension://${EXTENSION_ID}/`)) {
        await sleep(500);
        return page;
      }
    }
    await sleep(250);
  }
  throw new Error("the dashboard did not open");
}

async function worker(session) {
  for (let i = 0; i < 60; i++) {
    const target = (await session.cdp.targets()).find((t) => t.type === "service_worker" && t.url.includes(EXTENSION_ID));
    if (target) return session.cdp.page(target.targetId);
    await sleep(250);
  }
  throw new Error("the extension's worker did not start");
}

const storedStats = async (page) => {
  const stats = await page.eval(`chrome.storage.local.get("stats").then((v) => v.stats ?? null)`);
  const total = { ads: 0, trackers: 0, threats: 0 };
  for (const day of Object.values(stats?.days ?? {})) for (const key of Object.keys(total)) total[key] += day[key] ?? 0;
  return total;
};

const allPrefs = (profile) => {
  const regular = path.join(profile, "Default", "Preferences");
  const secure = path.join(profile, "Default", "Secure Preferences");
  return { ...(fs.existsSync(regular) ? profilePreferences(profile) : {}), ...(fs.existsSync(secure) ? securePreferences(profile) : {}) };
};

describe("rule files", () => {
  test("hold the expected kinds of rules", () => {
    const ads = readRules("ads");
    const trackers = readRules("trackers");
    const threats = readRules("threats");
    assert.ok(ads.length > 1000, `ads: ${ads.length}`);
    assert.ok(trackers.length > 1000, `trackers: ${trackers.length}`);
    assert.ok(threats.length > 2, `threats: ${threats.length}`);
  });

  test("stay within Chromium's limits", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir(), "manifest.json"), "utf8"));
    const total = manifest.declarative_net_request.rule_resources.reduce((n, r) => n + readRules(r.id).length, 0);
    assert.ok(total < 300000, `${total} rules`);
    assert.ok(manifest.declarative_net_request.rule_resources.every((r) => r.enabled));
    const regex = readRules("threats").filter((r) => r.condition.regexFilter).length;
    assert.ok(regex < 1000, `${regex} regex rules`);
  });

  test("the manifest asks for no permission that reads browsing history", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir(), "manifest.json"), "utf8"));
    for (const permission of ["history", "webNavigation", "webRequest", "tabs", "cookies", "topSites"]) {
      assert.ok(!manifest.permissions.includes(permission), permission);
    }
  });
});

describe("dashboard", () => {
  let session;
  let page;

  before(async () => {
    session = await launchHost();
    page = await dashboard(session);
  });

  after(async () => {
    await session.kill();
    removeProfile(session.profile);
  });

  test("replaces the new tab page with no prompt", { skip: process.platform === "win32" ? false : "window capture is Windows only" }, async () => {
    const shot = session.shot(path.join(session.profile, "..", `${path.basename(session.profile)}-windows`));
    const windows = shot.split("\n").filter((line) => line.includes("x"));
    for (const line of shot.split("\n")) fs.rmSync(line.split("  ")[0], { force: true });
    assert.equal(windows.length, 1, shot);
    assert.match(windows[0], /New Tab - Orbit/);
  });

  test("draws every default widget", async () => {
    const ids = await page.eval(`[...document.querySelectorAll(".widget")].filter((w) => !w.hidden).map((w) => w.dataset.id)`);
    assert.deepEqual(ids.sort(), ["bookmarks", "notes", "search", "stats", "weather"]);
  });

  test("runs under a strict content security policy with no page errors", async () => {
    const blocked = await page.eval(`(async () => {
      const results = {};
      const script = document.createElement("script");
      script.textContent = "window.inlineRan = true";
      document.head.append(script);
      script.remove();
      results.inlineScript = window.inlineRan ? "ran" : "blocked";
      try { await fetch("https://example.com/"); results.fetch = "ran"; } catch { results.fetch = "blocked"; }
      return results;
    })()`);
    assert.deepEqual(blocked, { inlineScript: "blocked", fetch: "blocked" });
  });

  test("contacts no weather service until a city is set", async () => {
    const calls = await page.eval(`performance.getEntriesByType("resource").map((e) => e.name).filter((n) => /^https?:/.test(n))`);
    assert.deepEqual(calls, []);
  });

  test("adds a bookmark through its form", async () => {
    await page.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Add bookmark").click()`);
    await sleep(200);
    await page.eval(`(() => {
      const dialog = document.querySelector("dialog.editor");
      dialog.querySelector('input[type="text"]').value = "Orbit test site";
      dialog.querySelector('input[inputmode="url"]').value = "example.org/page";
      dialog.querySelector("form").requestSubmit();
    })()`);
    await sleep(500);
    const titles = await page.eval(`[...document.querySelectorAll(".tile-title")].map((e) => e.textContent)`);
    assert.ok(titles.includes("Orbit test site"), JSON.stringify(titles));
    const stored = await page.eval(`chrome.bookmarks.search({ title: "Orbit test site" })`);
    assert.equal(stored[0].url, "https://example.org/page");
  });

  test("refuses a script address as a bookmark", async () => {
    await page.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Add bookmark").click()`);
    await sleep(200);
    const error = await page.eval(`(async () => {
      const dialog = document.querySelector("dialog.editor");
      dialog.querySelector('input[type="text"]').value = "bad";
      dialog.querySelector('input[inputmode="url"]').value = "javascript:alert(1)";
      dialog.querySelector("form").requestSubmit();
      await new Promise((r) => setTimeout(r, 200));
      const text = dialog.querySelector('[role="alert"]').textContent;
      dialog.close();
      dialog.remove();
      return text;
    })()`);
    assert.match(error, /valid web address/);
    assert.deepEqual(await page.eval(`chrome.bookmarks.search({ title: "bad" })`), []);
  });

  test("reorders bookmarks by dragging", async () => {
    await page.eval(`(async () => {
      for (const title of ["Second", "Third"]) await chrome.bookmarks.create({ parentId: "1", title, url: "https://example.org/" + title });
    })()`);
    await sleep(300);
    const order = () => page.eval(`chrome.bookmarks.getChildren("1").then((c) => c.map((n) => n.title))`);
    assert.deepEqual(await order(), ["Orbit test site", "Second", "Third"]);
    const drag = (fromTitle, toTitle) => page.eval(`(async () => {
      const tile = (t) => [...document.querySelectorAll(".tile")].find((e) => e.querySelector(".tile-title").textContent === t);
      const data = new DataTransfer();
      tile(${JSON.stringify(fromTitle)}).dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: data }));
      const target = tile(${JSON.stringify(toTitle)});
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: data }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: data }));
      await new Promise((r) => setTimeout(r, 300));
    })()`);
    await drag("Orbit test site", "Third");
    assert.deepEqual(await order(), ["Second", "Third", "Orbit test site"]);
    await drag("Orbit test site", "Second");
    assert.deepEqual(await order(), ["Orbit test site", "Second", "Third"]);
  });

  test("keeps notes and layout changes after a restart", async () => {
    await page.eval(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Add note").click()`);
    await sleep(200);
    await page.eval(`(() => {
      const area = document.querySelector(".note textarea");
      area.value = "Remember this after a restart";
      area.dispatchEvent(new Event("input", { bubbles: true }));
    })()`);
    await sleep(800);
    await page.eval(`(async () => {
      document.getElementById("open-customize").click();
      await new Promise((r) => setTimeout(r, 100));
      const row = [...document.querySelectorAll(".widget-list li")].find((li) => li.textContent.includes("Weather"));
      row.querySelector('input[type="checkbox"]').click();
      await new Promise((r) => setTimeout(r, 200));
      document.querySelector("#customize").close();
    })()`);
    await sleep(300);
    await session.closeWindows();
    await waitForExit(session);

    session = await launchHost({ profile: session.profile, checkProfile: false });
    page = await dashboard(session);
    const text = await page.eval(`document.querySelector(".note textarea")?.value`);
    assert.equal(text, "Remember this after a restart");
    const hidden = await page.eval(`document.querySelector('.widget[data-id="weather"]').hidden`);
    assert.equal(hidden, true);
  });

  test("survives corrupted saved data", async () => {
    await page.eval(`chrome.storage.local.set({ settings: "x", layout: 7, notes: { a: 1 }, stats: [], weatherPlace: "nowhere" })`);
    await page.goto("chrome://newtab/", { settleMs: 800 }).catch(() => {});
    const again = await dashboard(session);
    const ids = await again.eval(`[...document.querySelectorAll(".widget")].map((w) => w.dataset.id)`);
    assert.equal(ids.length, 5);
    const visibleText = await again.eval(`document.querySelector('.widget[data-id="stats"]').textContent`);
    assert.match(visibleText, /Ads blocked/);
    page = again;
  });
});

describe("Shields", () => {
  let fixture;
  let session;
  let page;
  let origin;

  before(async () => {
    fixture = await startFixture();
    origin = `http://localhost:${fixture.port}`;
    session = await launchHost({ args: [`--host-resolver-rules=MAP ${AD_HOST} 127.0.0.1, MAP ${TRACKER_HOST} 127.0.0.1`] });
    page = await dashboard(session);
    await worker(session);
  });

  after(async () => {
    await session.kill();
    removeProfile(session.profile);
    await fixture.close();
  });

  async function visitAdPage() {
    const url = `${origin}/ads-page?ad=${AD_HOST}:${fixture.port}&tracker=${TRACKER_HOST}:${fixture.port}`;
    const tab = await session.cdp.newPage("about:blank");
    await tab.goto(url, { settleMs: COUNT_DELAY_MS });
    return tab;
  }

  test("blocks real ad and tracker hosts before they get a request", async () => {
    fixture.log.length = 0;
    const tab = await visitAdPage();
    await tab.close();
    assert.ok(fixture.log.some((e) => e.path === "/ads-page"), "the page itself did not load");
    const leaked = fixture.log.filter((e) => e.host === AD_HOST || e.host === TRACKER_HOST).map((e) => e.host);
    assert.deepEqual(leaked, []);
  });

  test("counts exactly what was blocked", async () => {
    const before = await storedStats(page);
    assert.deepEqual(before, { ads: 2, trackers: 1, threats: 0 });
    const tab = await visitAdPage();
    await tab.close();
    assert.deepEqual(await storedStats(page), { ads: 4, trackers: 2, threats: 0 });
  });

  test("shows the real counts on the dashboard", async () => {
    await page.goto("chrome://newtab/", { settleMs: 500 }).catch(() => {});
    const again = await dashboard(session);
    await again.eval(`(() => {
      const select = document.querySelector('.widget[data-id="stats"] select');
      select.value = "today";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await sleep(300);
    const numbers = await again.eval(`[...document.querySelectorAll('.widget[data-id="stats"] dd')].map((e) => e.textContent)`);
    assert.deepEqual(numbers, ["4", "2", "0"]);
    page = again;
  });

  test("stores no address of anything it blocked", async () => {
    const stored = await page.eval(`chrome.storage.local.get(null).then((all) => JSON.stringify(all))`);
    assert.ok(!stored.includes(AD_HOST), "ad host found in local storage");
    assert.ok(!stored.includes(TRACKER_HOST), "tracker host found in local storage");
    const session = await page.eval(`chrome.storage.session.get(null).then((all) => JSON.stringify(all))`);
    assert.ok(!session.includes(AD_HOST), "ad host found in session storage");
  });

  test("a site switch lets that site load everything, and stops counting", async () => {
    const before = await storedStats(page);
    await page.eval(`chrome.runtime.sendMessage({ type: "set-shields", host: "localhost", enabled: false, incognito: false })`);
    fixture.log.length = 0;
    const tab = await visitAdPage();
    await tab.close();
    assert.ok(fixture.log.some((e) => e.host === AD_HOST), "the ad host should load with Shields off");
    assert.deepEqual(await storedStats(page), before);

    await page.eval(`chrome.runtime.sendMessage({ type: "set-shields", host: "localhost", enabled: true, incognito: false })`);
    fixture.log.length = 0;
    const blocked = await visitAdPage();
    await blocked.close();
    assert.ok(!fixture.log.some((e) => e.host === AD_HOST), "the ad host should be blocked again");
  });

  test("blocks in a private window, and that window's site switch is not saved", async () => {
    const sw = await worker(session);
    const url = `${origin}/ads-page?ad=${AD_HOST}:${fixture.port}&tracker=${TRACKER_HOST}:${fixture.port}&private=1`;
    fixture.log.length = 0;
    const created = await sw.eval(`chrome.windows.create({ incognito: true, url: ${JSON.stringify(url)} }).then((w) => w.id)`);
    await sleep(COUNT_DELAY_MS + 500);
    assert.ok(fixture.log.some((e) => e.path === "/ads-page"), "the private page did not load");
    assert.ok(!fixture.log.some((e) => e.host === AD_HOST || e.host === TRACKER_HOST), "a tracker loaded in the private window");

    await page.eval(`chrome.runtime.sendMessage({ type: "set-shields", host: "private-only.example", enabled: false, incognito: true })`);
    const stored = await page.eval(`chrome.storage.local.get("sitesOff")`);
    assert.ok(!JSON.stringify(stored).includes("private-only.example"));
    const session_ = await page.eval(`chrome.storage.session.get("privateSitesOff")`);
    assert.ok(JSON.stringify(session_).includes("private-only.example"));
    await sw.eval(`chrome.windows.remove(${created})`);
  });

  test("the counter survives a reset", async () => {
    await page.eval(`chrome.runtime.sendMessage({ type: "reset-stats" })`);
    assert.deepEqual(await storedStats(page), { ads: 0, trackers: 0, threats: 0 });
    const tab = await visitAdPage();
    await tab.close();
    assert.deepEqual(await storedStats(page), { ads: 2, trackers: 1, threats: 0 });
  });
});

describe("threat warning", () => {
  let session;
  let host;

  before(async () => {
    host = readRules("threats").find((r) => r.condition.regexFilter).condition.requestDomains[0];
    session = await launchHost({ args: [`--host-resolver-rules=MAP ${host} 127.0.0.1:9`] });
    await worker(session);
  });

  after(async () => {
    await session.kill();
    removeProfile(session.profile);
  });

  test("stops a listed site at Orbit's warning page, with a way through", async () => {
    const page = await session.cdp.newPage("about:blank");
    await page.goto(`https://${host}/landing?x=1`, { settleMs: 800 }).catch(() => {});
    const href = await page.eval("location.href");
    assert.equal(href, `chrome-extension://${EXTENSION_ID}/blocked/blocked.html#https://${host}/landing?x=1`);
    const shown = await page.eval(`document.getElementById("host").textContent`);
    assert.equal(shown, host);

    await page.eval(`document.getElementById("continue").click()`);
    await sleep(1500);
    const url = (await session.pages()).find((t) => t.targetId === page.targetId).url;
    assert.ok(url.startsWith(`https://${host}/`), url);
    await page.close();
  });

  test("counts the stopped page as a threat", async () => {
    await sleep(COUNT_DELAY_MS);
    const sw = await worker(session);
    const stats = await sw.eval(`chrome.storage.local.get("stats").then((v) => Object.values(v.stats.days)[0].threats)`);
    assert.equal(stats, 1);
  });
});

describe("host link", () => {
  let fixture;
  let session;
  let page;

  before(async () => {
    fixture = await startFixture();
    session = await launchHost();
    page = await dashboard(session);
  });

  after(async () => {
    await session.kill();
    removeProfile(session.profile);
    await fixture.close();
  });

  const setTheme = (from, mode) =>
    from.eval(`fetch("https://orbit.invalid/theme", { method: "POST", body: JSON.stringify({ mode: ${JSON.stringify(mode)}, accent: "#8d9bff" }) }).then((r) => r.status, () => "failed")`);

  test("changes the browser's colors for Orbit's own pages", async () => {
    assert.equal(await setTheme(page, "light"), 200);
    await sleep(500);
    assert.equal(await page.eval(`matchMedia("(prefers-color-scheme: dark)").matches`), false);
    assert.equal(await setTheme(page, "dark"), 200);
    await sleep(500);
    assert.equal(await page.eval(`matchMedia("(prefers-color-scheme: dark)").matches`), true);
  });

  test("rejects bad values", async () => {
    assert.equal(await setTheme(page, "neon"), 400);
  });

  test("refuses every website", async () => {
    const site = await session.cdp.newPage(`http://localhost:${fixture.port}/`);
    await sleep(500);
    const before = await page.eval(`matchMedia("(prefers-color-scheme: dark)").matches`);
    const result = await setTheme(site, before ? "light" : "dark");
    await sleep(500);
    await site.close();
    assert.equal(result, "failed");
    assert.equal(await page.eval(`matchMedia("(prefers-color-scheme: dark)").matches`), before);
  });
});

describe("release build", () => {
  test("loads the extension and its rules", async () => {
    const profile = tempProfile();
    const session = await launchHost({ variant: "orbit", profile });
    try {
      // Preferences reach the disk about 10 seconds after a change.
      await sleep(13000);
      assert.equal(session.exit, null);
    } finally {
      await session.kill();
    }
    await sleep(500);
    const entry = pref(allPrefs(profile), `extensions.settings.${EXTENSION_ID}`);
    removeProfile(profile);
    assert.ok(entry, "the extension is not registered");
    assert.equal(entry.incognito, true);
    assert.ok(entry.dnr_static_ruleset, "its rules were not indexed");
  });
});
