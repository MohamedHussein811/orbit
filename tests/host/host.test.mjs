// End-to-end checks of the built Orbit host. Every run uses a throwaway profile.
//   node tools/build-host.mjs && node --test --test-concurrency=1 tests/host/host.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { startFixture } from "./lib/fixture.mjs";
import {
  binaryPath,
  freePort,
  hostProcesses,
  launchHost,
  localState,
  portIsOpen,
  pref,
  profilePreferences,
  removeProfile,
  securePreferences,
  sleep,
  tempProfile,
  waitForExit,
} from "./lib/host.mjs";

const NO_TEST_PROFILE_EXIT = 78;
const PROCESS_NOTIFIED_EXIT = 24;
const STARTUP_RESTORE = 1;
const STARTUP_URLS = 4;
const STARTUP_NEW_TAB = 5;
// Chromium writes preferences about 10 seconds after a change, so a crash test waits longer.
const PREFS_WRITTEN_MS = 13000;
const windowsOnly = { skip: process.platform === "win32" ? false : "window input is only implemented on Windows" };

async function evalOn(session, url, expression) {
  const page = await session.cdp.newPage(url);
  await sleep(1200);
  try {
    return await page.eval(expression);
  } finally {
    await page.close();
  }
}

const setPref = (session, name, value) =>
  evalOn(session, "chrome://settings/", `chrome.settingsPrivate.setPref(${JSON.stringify(name)}, ${JSON.stringify(value)})`);

const getPref = async (session, name) =>
  (await evalOn(session, "chrome://settings/", `chrome.settingsPrivate.getPref(${JSON.stringify(name)})`)).value;

const defaultSearchEngine = (session) =>
  evalOn(
    session,
    "chrome://settings/search",
    `import("chrome://resources/js/cr.js").then((cr) => cr.sendWithPromise("getSearchEnginesList")).then((all) => all.defaults.find((e) => e.default)?.name)`,
  );

async function closeCleanly(session) {
  await session.closeWindows();
  return waitForExit(session);
}

async function openTabs(session, urls) {
  for (const url of urls) await session.cdp.send("Target.createTarget", { url });
  await sleep(1500);
}

async function pageUrlsAfterStart(session, waitMs = 6000) {
  await sleep(waitMs);
  return (await session.pages()).map((t) => t.url);
}

describe("profile safety", () => {
  test("the test build refuses to start without a test profile", () => {
    const env = { ...process.env };
    delete env.ORBIT_USER_DATA_DIR;
    const result = spawnSync(binaryPath("orbit_test"), [], { env, timeout: 30000 });
    assert.equal(result.status, NO_TEST_PROFILE_EXIT);
  });
});

describe("defaults", () => {
  let profile;
  let session;

  before(async () => {
    profile = tempProfile();
    session = await launchHost({ profile });
    await sleep(2000);
  });

  after(async () => {
    await session.kill();
    removeProfile(profile);
  });

  test("opens the tabbed browser on the new tab page", async () => {
    const pages = await session.pages();
    assert.ok(pages.some((t) => t.url === "chrome://newtab/"), JSON.stringify(pages.map((t) => t.url)));
  });

  test("passes the privacy switches to the browser", async () => {
    const line = await evalOn(session, "chrome://version/", `document.getElementById("command_line").innerText`);
    for (const value of ["--disable-domain-reliability", "--disable-sync", "--no-pings", "--disable-default-apps"]) {
      assert.ok(line.includes(value), `${value} missing`);
    }
    assert.ok(/--enable-features=[^ ]*CertificateTransparencyAskBeforeEnabling/.test(line), "certificate transparency feature missing");
    assert.ok(/--disable-features=[^ ]*AimEnabled/.test(line), "AI mode feature missing");
    assert.ok(/--disable-features=[^ ]*NetworkTimeServiceQuerying/.test(line), "network time feature missing");
    assert.ok(/--disable-blink-features=[^ ]*AIPromptAPI/.test(line), "AI API list missing");
  });

  test("keeps component updates on, because they carry revocation data", async () => {
    const line = await evalOn(session, "chrome://version/", `document.getElementById("command_line").innerText`);
    assert.ok(!line.includes("--disable-component-update"));
    assert.ok(!line.includes("--disable-background-networking"));
  });

  test("uses DuckDuckGo as the default search", async () => {
    assert.equal(await defaultSearchEngine(session), "DuckDuckGo");
  });

  test("hides AI and advertising APIs from pages", async () => {
    const present = await evalOn(
      session,
      "chrome://version/",
      `JSON.stringify({
        languageModel: "LanguageModel" in self,
        summarizer: "Summarizer" in self,
        writer: "Writer" in self,
        rewriter: "Rewriter" in self,
        proofreader: "Proofreader" in self,
        translator: "Translator" in self,
        languageDetector: "LanguageDetector" in self,
        topics: "browsingTopics" in document,
        interestGroups: "joinAdInterestGroup" in navigator,
        auctions: "runAdAuction" in navigator,
        sharedStorage: "sharedStorage" in self,
        attribution: "attributionReporting" in self,
        fencedFrames: "HTMLFencedFrameElement" in self,
      })`,
    );
    const found = Object.entries(JSON.parse(present)).filter(([, value]) => value).map(([name]) => name);
    assert.deepEqual(found, []);
  });

  test("stores the seeded preferences on clean exit", async () => {
    const exit = await closeCleanly(session);
    assert.equal(exit.code, 0);
    const prefs = profilePreferences(profile);
    assert.equal(pref(prefs, "profile.exit_type"), "Normal");
    assert.equal(pref(prefs, "orbit.defaults_version"), 1);
    assert.equal(pref(prefs, "profile.cookie_controls_mode"), 1);
    assert.equal(pref(prefs, "https_only_mode_enabled"), true);
    assert.equal(pref(prefs, "safebrowsing.enabled"), false);
    assert.equal(pref(prefs, "search.suggest_enabled"), false);
    assert.equal(pref(prefs, "net.network_prediction_options"), 2);
    assert.equal(pref(prefs, "translate.enabled"), false);
    assert.equal(pref(prefs, "alternate_error_pages.enabled"), false);
    assert.equal(pref(prefs, "url_keyed_anonymized_data_collection.enabled"), false);
    assert.equal(pref(prefs, "spellcheck.use_spelling_service"), false);
    assert.equal(pref(prefs, "signin.allowed"), false);
    const state = localState(profile);
    assert.equal(pref(state, "dns_over_https.mode"), "secure");
    assert.equal(pref(state, "dns_over_https.templates"), "https://dns.quad9.net/dns-query");
    assert.equal(pref(state, "user_experience_metrics.reporting_enabled"), false);
  });

  test("keeps the search default and a user's changes after a restart", async () => {
    const first = await launchHost({ profile, checkProfile: false });
    try {
      assert.equal(await defaultSearchEngine(first), "DuckDuckGo");
      await setPref(first, "https_only_mode_enabled", false);
      await sleep(500);
      await closeCleanly(first);
    } finally {
      await first.kill();
    }
    const second = await launchHost({ profile, checkProfile: false });
    try {
      assert.equal(await defaultSearchEngine(second), "DuckDuckGo");
      await closeCleanly(second);
    } finally {
      await second.kill();
    }
    assert.equal(pref(profilePreferences(profile), "https_only_mode_enabled"), false);
  });
});

describe("branding", () => {
  let session;

  before(async () => {
    session = await launchHost();
    await sleep(1000);
  });

  after(async () => {
    await session.kill();
    removeProfile(session.profile);
  });

  test("uses Orbit's name in browser strings", async () => {
    const title = await evalOn(session, "chrome://settings/help", `(async () => {
      await new Promise((r) => setTimeout(r, 500));
      const deep = (root) => {
        let text = "";
        for (const e of root.querySelectorAll("*")) {
          if (e.shadowRoot) text += deep(e.shadowRoot);
          if (!e.children.length) text += " " + e.textContent;
        }
        return text;
      };
      return deep(document);
    })()`);
    assert.ok(/About Orbit/.test(title), title.slice(0, 400));
    assert.ok(!/About Chromium/.test(title));
  });

  test("keeps the attribution to the Chromium project", async () => {
    const version = await evalOn(session, "chrome://version/", "document.body.innerText");
    assert.ok(/Chromium Authors/.test(version), version.slice(0, 400));
    const license = await evalOn(session, "chrome://settings/help", `(async () => {
      await new Promise((r) => setTimeout(r, 500));
      const find = (root) => {
        for (const e of root.querySelectorAll("*")) {
          if (e.localName === "a" && e.textContent.trim() === "Chromium") return e.parentElement.textContent;
          const inner = e.shadowRoot && find(e.shadowRoot);
          if (inner) return inner;
        }
        return "";
      };
      return find(document);
    })()`);
    assert.match(license.replace(/\s+/g, " "), /Orbit is made possible by the Chromium open source project/);
  });

  test("shows Orbit's logo", async () => {
    const page = await session.cdp.newPage("about:blank");
    const url = "chrome://theme/current-channel-logo";
    await page.goto(url, { settleMs: 300 });
    const tree = await page.send("Page.getResourceTree");
    const { content } = await page.send("Page.getResourceContent", { frameId: tree.frameTree.frame.id, url });
    await page.close();
    const icons = new URL("../../branding/icons/", import.meta.url);
    const allowed = ["orbit-16.png", "orbit-32.png", "orbit-64.png"].map((f) => fs.readFileSync(new URL(f, icons)).toString("base64"));
    assert.ok(allowed.includes(content), "logo does not match branding/icons");
  });

  test("names Orbit and NovaTech on the Windows executable", { skip: process.platform === "win32" ? false : "Windows only" }, () => {
    const exe = binaryPath("orbit_test").replaceAll("'", "''");
    const info = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-Item '${exe}').VersionInfo | Select-Object ProductName,CompanyName,FileDescription | ConvertTo-Json -Compress`], { encoding: "utf8" });
    assert.deepEqual(JSON.parse(info), { ProductName: "Orbit", CompanyName: "NovaTech", FileDescription: "Orbit" });
  });
});

describe("web behaviour", () => {
  let fixture;
  let session;

  before(async () => {
    fixture = await startFixture();
    session = await launchHost({ args: ["--host-resolver-rules=MAP *.test 127.0.0.1, MAP duckduckgo.com 127.0.0.1:9"] });
  });

  after(async () => {
    await session.kill();
    removeProfile(session.profile);
    await fixture.close();
  });

  test("warns before loading a plain HTTP site, and sends it nothing", async () => {
    fixture.log.length = 0;
    const page = await session.cdp.newPage("about:blank");
    const result = await page.goto(`http://a.test:${fixture.port}/`, { settleMs: 1500, timeoutMs: 15000 });
    await page.close();
    assert.equal(result.errorText, "net::ERR_BLOCKED_BY_CLIENT");
    assert.deepEqual(fixture.log, []);
  });

  test("does not send link pings", async () => {
    fixture.log.length = 0;
    const page = await session.cdp.newPage(`http://localhost:${fixture.port}/ping-test`);
    await sleep(800);
    await page.eval(`document.getElementById("link").click()`);
    await sleep(1500);
    await page.close();
    assert.ok(fixture.log.some((e) => e.path === "/ping-target"), "link was not followed");
    assert.ok(!fixture.log.some((e) => e.path === "/ping"), "ping was sent");
  });

  test("sends a typed search to DuckDuckGo", windowsOnly, async () => {
    const page = await session.cdp.newPage("about:blank");
    await sleep(800);
    const searched = (urls) => urls.some((u) => u.startsWith("https://duckduckgo.com/?q=orbit+test+search"));
    let urls = [];
    // Posted shortcuts can be dropped while another application holds the foreground.
    for (let attempt = 1; attempt <= 3 && !searched(urls); attempt++) {
      await page.send("Page.bringToFront");
      session.input("focus");
      await sleep(500);
      session.input("ctrl+l");
      await sleep(500);
      session.input("text:orbit test search");
      await sleep(500);
      session.input("enter");
      await sleep(2500);
      urls = (await session.pages()).map((t) => t.url);
    }
    await page.close();
    assert.ok(searched(urls), JSON.stringify(urls));
  });

  test("runs renderers in the sandbox", async () => {
    const page = await session.cdp.newPage("chrome://sandbox/");
    await sleep(2000);
    const text = await page.text(6000);
    await page.close();
    if (process.platform === "win32") {
      assert.ok(/Renderer/.test(text) && /Lockdown/.test(text), text.slice(0, 800));
    } else if (process.platform === "linux") {
      assert.match(text, /adequately sandboxed/i);
    } else {
      const renderers = hostProcesses("orbit_test", session.profile).filter((p) => p.commandLine.includes("--type=renderer"));
      assert.ok(renderers.length > 0, "no renderer found");
      assert.ok(renderers.every((p) => p.commandLine.includes("--seatbelt-client")), renderers[0].commandLine);
    }
  });
});

describe("startup setting", () => {
  let fixture;
  let origin;

  before(async () => {
    fixture = await startFixture();
    origin = `http://localhost:${fixture.port}`;
  });

  after(() => fixture.close());

  test("restores tabs after a clean exit when the setting is on, and keeps the setting", async () => {
    const profile = tempProfile();
    const first = await launchHost({ profile });
    await setPref(first, "session.restore_on_startup", STARTUP_RESTORE);
    await openTabs(first, [`${origin}/?tab=one`, `${origin}/?tab=two`]);
    await closeCleanly(first);
    const second = await launchHost({ profile, checkProfile: false });
    try {
      const urls = await pageUrlsAfterStart(second);
      assert.ok(urls.includes(`${origin}/?tab=one`) && urls.includes(`${origin}/?tab=two`), JSON.stringify(urls));
      // One new tab page was part of the restored window. A second would be the start tab left open.
      assert.equal(urls.filter((u) => u === "chrome://newtab/").length, 1, JSON.stringify(urls));
      assert.equal(await getPref(second, "session.restore_on_startup"), STARTUP_RESTORE);
    } finally {
      await second.kill();
      removeProfile(profile);
    }
  });

  test("keeps a URL from the command line when restoring", async () => {
    const profile = tempProfile();
    const first = await launchHost({ profile });
    await setPref(first, "session.restore_on_startup", STARTUP_RESTORE);
    await openTabs(first, [`${origin}/?tab=one`]);
    await closeCleanly(first);
    const second = await launchHost({ profile, checkProfile: false, urls: [`${origin}/?from=link`] });
    try {
      const urls = await pageUrlsAfterStart(second);
      assert.ok(urls.includes(`${origin}/?tab=one`) && urls.includes(`${origin}/?from=link`), JSON.stringify(urls));
    } finally {
      await second.kill();
      removeProfile(profile);
    }
  });

  test("opens the chosen pages when the setting asks for them", async () => {
    const profile = tempProfile();
    const first = await launchHost({ profile });
    await setPref(first, "session.restore_on_startup", STARTUP_URLS);
    await setPref(first, "session.startup_urls", [`${origin}/?page=a`, `${origin}/?page=b`]);
    await sleep(500);
    await closeCleanly(first);
    const second = await launchHost({ profile, checkProfile: false });
    try {
      const urls = await pageUrlsAfterStart(second, 4000);
      assert.ok(urls.includes(`${origin}/?page=a`) && urls.includes(`${origin}/?page=b`), JSON.stringify(urls));
      assert.ok(!urls.includes("chrome://newtab/"), JSON.stringify(urls));
      assert.equal(await getPref(second, "session.restore_on_startup"), STARTUP_URLS);
    } finally {
      await second.kill();
      removeProfile(profile);
    }
  });

  test("starts fresh after a clean exit when the setting is off", async () => {
    const profile = tempProfile();
    const first = await launchHost({ profile });
    await openTabs(first, [`${origin}/?tab=one`]);
    await closeCleanly(first);
    const second = await launchHost({ profile, checkProfile: false });
    try {
      const urls = await pageUrlsAfterStart(second);
      assert.ok(!urls.some((u) => u.startsWith(origin)), JSON.stringify(urls));
      assert.equal(await getPref(second, "session.restore_on_startup"), STARTUP_NEW_TAB);
    } finally {
      await second.kill();
      removeProfile(profile);
    }
  });

  test("restores tabs after a crash, whatever the setting", async () => {
    const profile = tempProfile();
    const first = await launchHost({ profile });
    await openTabs(first, [`${origin}/?tab=one`, `${origin}/?tab=two`]);
    await sleep(PREFS_WRITTEN_MS);
    await first.kill();
    assert.equal(pref(profilePreferences(profile), "profile.exit_type"), "Crashed");
    const second = await launchHost({ profile, checkProfile: false });
    try {
      const urls = await pageUrlsAfterStart(second);
      assert.ok(urls.includes(`${origin}/?tab=one`) && urls.includes(`${origin}/?tab=two`), JSON.stringify(urls));
      assert.ok(fs.existsSync(path.join(profile, "orbit-restore-guard")), "guard file missing during restore");
    } finally {
      await second.kill();
      removeProfile(profile);
    }
  });

  test("opens empty when the restore itself crashes", async () => {
    const profile = tempProfile();
    const first = await launchHost({ profile });
    await openTabs(first, [`${origin}/?tab=one`]);
    await sleep(PREFS_WRITTEN_MS);
    await first.kill();
    const second = await launchHost({ profile, checkProfile: false });
    await sleep(PREFS_WRITTEN_MS);
    assert.ok(fs.existsSync(path.join(profile, "orbit-restore-guard")), "guard file missing during restore");
    await second.kill();
    const third = await launchHost({ profile, checkProfile: false });
    try {
      const urls = await pageUrlsAfterStart(third);
      assert.ok(!urls.some((u) => u.startsWith(origin)), JSON.stringify(urls));
      assert.ok(!fs.existsSync(path.join(profile, "orbit-restore-guard")), "guard file should be gone");
    } finally {
      await third.kill();
      removeProfile(profile);
    }
  });
});

describe("single instance", () => {
  let fixture;
  let origin;
  let first;

  before(async () => {
    fixture = await startFixture();
    origin = `http://localhost:${fixture.port}`;
    first = await launchHost();
  });

  after(async () => {
    await first.kill();
    removeProfile(first.profile);
    await fixture.close();
  });

  test("a second launch with a URL opens a tab in the running browser", async () => {
    const before = (await first.cdp.targets()).filter((t) => t.type === "page").length;
    const second = await launchHost({ profile: first.profile, connect: false, urls: [`${origin}/?from=second`] });
    const exit = await waitForExit(second, 15000);
    assert.equal(exit.code, PROCESS_NOTIFIED_EXIT);
    await sleep(1500);
    const pages = await first.pages();
    assert.ok(pages.map((t) => t.url).includes(`${origin}/?from=second`), JSON.stringify(pages.map((t) => t.url)));
    assert.equal(pages.length, before + 1);
  });

  test("a second launch with a file path opens that file", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-host-file-"));
    const file = path.join(dir, "a page & more.html");
    fs.writeFileSync(file, "<!doctype html><title>Local</title><h1>Local page</h1>");
    const second = await launchHost({ profile: first.profile, connect: false, urls: [file] });
    assert.equal((await waitForExit(second, 15000)).code, PROCESS_NOTIFIED_EXIT);
    await sleep(1500);
    const urls = (await first.pages()).map((t) => t.url);
    fs.rmSync(dir, { recursive: true, force: true });
    assert.ok(urls.some((u) => u.startsWith("file:") && u.endsWith("/a%20page%20%26%20more.html")), JSON.stringify(urls));
  });

  test("a second launch ignores a script URL and a missing file", async () => {
    const before = (await first.pages()).map((t) => t.url);
    const second = await launchHost({ profile: first.profile, connect: false, urls: ["javascript:alert(1)"] });
    assert.equal((await waitForExit(second, 15000)).code, PROCESS_NOTIFIED_EXIT);
    await sleep(1500);
    const urls = (await first.pages()).map((t) => t.url);
    assert.ok(!urls.some((u) => u.startsWith("javascript:")), JSON.stringify(urls));
    assert.ok(urls.length >= before.length);
  });

  test("a second launch without a URL opens a new page", async () => {
    const before = (await first.pages()).length;
    const second = await launchHost({ profile: first.profile, connect: false });
    const exit = await waitForExit(second, 15000);
    assert.equal(exit.code, PROCESS_NOTIFIED_EXIT);
    await sleep(1500);
    assert.equal((await first.pages()).length, before + 1);
  });
});

describe("closing the last window", () => {
  test("quits on Windows and Linux, and keeps a Mac app running until it is quit", async () => {
    const session = await launchHost();
    try {
      for (const target of await session.pages()) {
        await session.cdp.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
      }
      await sleep(4000);
      if (process.platform === "darwin") {
        assert.equal(session.exit, null, "the app quit when its last window closed");
        const again = await launchHost({ profile: session.profile, connect: false });
        assert.equal((await waitForExit(again, 15000)).code, PROCESS_NOTIFIED_EXIT);
        await sleep(2000);
        assert.equal((await session.pages()).length, 1, "a new launch should open a window");
        await session.cdp.send("Browser.close", {}, undefined, 8000).catch(() => {});
        assert.equal((await waitForExit(session)).code, 0);
      } else {
        assert.equal((await waitForExit(session)).code, 0);
      }
    } finally {
      await session.kill();
      removeProfile(session.profile);
    }
  });
});

describe("release build", () => {
  test("ignores switches and opens no debugging port", async () => {
    const profile = tempProfile();
    const stray = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-host-stray-"));
    const port = await freePort();
    const session = await launchHost({
      variant: "orbit",
      profile,
      args: [`--remote-debugging-port=${port}`, "--remote-allow-origins=*", `--root-cache-path=${stray}`, "--no-sandbox", "--disable-web-security"],
    });
    try {
      await sleep(5000);
      assert.equal(session.exit, null, "release build exited early");
      assert.equal(await portIsOpen(port), false, "debugging port opened");
      assert.ok(fs.existsSync(path.join(profile, "Local State")), "profile not in the expected folder");
      assert.deepEqual(fs.readdirSync(stray), [], "a switch moved the profile");
      const lines = hostProcesses("orbit", profile).map((p) => p.commandLine);
      assert.ok(lines.length > 1, "expected child processes");
      assert.ok(!lines.some((l) => l.includes("--no-sandbox") && l.includes("--type=")), "a child process lost the sandbox");
      assert.ok(!lines.some((l) => l.includes("--disable-web-security") && l.includes("--type=")), "a child process lost web security");
      if (process.platform === "win32") {
        await session.closeWindows();
        assert.equal((await waitForExit(session)).code, 0);
      }
    } finally {
      await session.kill();
      removeProfile(profile);
      fs.rmSync(stray, { recursive: true, force: true });
    }
  });
});
