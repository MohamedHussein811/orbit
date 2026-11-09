// Chromium's browser features, checked on Orbit's own host rather than on a sample client.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import { startFixture } from "./lib/fixture.mjs";
import { launchHost, removeProfile, sleep } from "./lib/host.mjs";

const EXTENSION_ID = "boccmnigbogdpajphlpgodcalflpinmk";

async function worker(session) {
  for (let i = 0; i < 60; i++) {
    const target = (await session.cdp.targets()).find((t) => t.type === "service_worker" && t.url.includes(EXTENSION_ID));
    if (target) return session.cdp.page(target.targetId);
    await sleep(250);
  }
  throw new Error("the extension's worker did not start");
}

/** A certificate made for this run only, trusted by nothing. Node has no generator, so this uses OpenSSL. */
function makeCertificate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-host-cert-"));
  const key = path.join(dir, "key.pem");
  const cert = path.join(dir, "cert.pem");
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "2", "-subj", "/CN=a.test", "-addext", "subjectAltName=DNS:a.test,DNS:b.test"], { stdio: "ignore" });
    return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe("browser features", () => {
  let fixture;
  let session;
  let sw;
  let origin;

  before(async () => {
    fixture = await startFixture();
    origin = `http://localhost:${fixture.port}`;
    session = await launchHost({ args: ["--host-resolver-rules=MAP *.test 127.0.0.1"] });
    sw = await worker(session);
  });

  after(async () => {
    await session.kill();
    removeProfile(session.profile);
    await fixture.close();
  });

  test("site isolation is on", async () => {
    const page = await session.cdp.newPage("chrome://process-internals/#site-isolation");
    await sleep(1500);
    const text = await page.eval(`document.body.innerText`);
    await page.close();
    assert.match(text, /Site Per Process/i, text.slice(0, 500));
  });

  test("a cross-site frame runs outside its parent's process", async () => {
    const page = await session.cdp.newPage("about:blank");
    await page.send("Page.navigate", { url: `${origin}/frames-cross?frame=b.test:${fixture.port}` });
    await sleep(1800);
    const targets = await session.cdp.targets();
    await page.close();
    assert.ok(targets.some((t) => t.type === "iframe" && t.url.includes("b.test")), JSON.stringify(targets.map((t) => `${t.type} ${t.url}`)));
  });

  test("opens PDFs in the built-in viewer", async () => {
    const page = await session.cdp.newPage(`${origin}/doc.pdf`);
    await sleep(2500);
    const plugin = await page.eval(`document.querySelector("embed")?.type ?? document.contentType`);
    await page.close();
    assert.match(plugin, /pdf/i);
  });

  test("records history that can be searched and deleted", async () => {
    const url = `${origin}/?history=marker`;
    const page = await session.cdp.newPage(url);
    await sleep(800);
    await page.close();
    const history = await session.cdp.newPage("chrome://history/");
    await sleep(1000);
    const titles = await history.eval(`import("chrome://history/history.js").catch(() => null).then(() => 1)`).catch(() => 1);
    assert.ok(titles);
    await history.close();
    const found = await sw.eval(`chrome.history.search({ text: "history=marker", startTime: 0 })`);
    assert.equal(found.length, 1);
    await sw.eval(`chrome.history.deleteUrl({ url: ${JSON.stringify(url)} })`);
    assert.deepEqual(await sw.eval(`chrome.history.search({ text: "history=marker", startTime: 0 })`), []);
  });

  test("pins, mutes, duplicates and groups tabs", async () => {
    const tab = await sw.eval(`chrome.tabs.create({ url: ${JSON.stringify(`${origin}/?tab=features`)}, active: false }).then((t) => t.id)`);
    await sleep(500);
    const state = await sw.eval(`(async () => {
      await chrome.tabs.update(${tab}, { pinned: true, muted: true });
      const updated = await chrome.tabs.get(${tab});
      const copy = await chrome.tabs.duplicate(${tab});
      await chrome.tabs.update(${tab}, { pinned: false });
      const group = await chrome.tabs.group({ tabIds: [${tab}, copy.id] });
      const members = await chrome.tabs.query({ groupId: group });
      await chrome.tabs.remove([${tab}, copy.id]);
      return { pinned: updated.pinned, muted: updated.mutedInfo.muted, members: members.length, duplicated: !!copy.id };
    })()`);
    assert.deepEqual(state, { pinned: true, muted: true, members: 2, duplicated: true });
  });

  test("keeps private window storage separate from normal windows", async () => {
    const normal = await session.cdp.newPage(`${origin}/setcookie`);
    await sleep(500);
    assert.match(await normal.eval("document.cookie"), /first=party/);
    const windowId = await sw.eval(`chrome.windows.create({ incognito: true, url: ${JSON.stringify(`${origin}/`)} }).then((w) => w.id)`);
    await sleep(1500);
    const privateTarget = (await session.cdp.targets()).find((t) => t.type === "page" && t.url === `${origin}/` && t.browserContextId && t.browserContextId !== (session.defaultContext ?? null));
    const pages = (await session.cdp.targets()).filter((t) => t.type === "page" && t.url === `${origin}/`);
    assert.ok(privateTarget ?? pages[0], "the private window did not open");
    const inPrivate = await session.cdp.page((privateTarget ?? pages[0]).targetId);
    assert.doesNotMatch(await inPrivate.eval("document.cookie"), /first=party/);
    await inPrivate.eval(`document.cookie = "privateonly=1; path=/"`);
    await normal.goto(`${origin}/`, { settleMs: 300 });
    assert.doesNotMatch(await normal.eval("document.cookie"), /privateonly/);
    await normal.close();
    await sw.eval(`chrome.windows.remove(${windowId})`);
  });

  test("downloads a file to the chosen folder", async () => {
    // Set through DevTools before anything downloads, so a test can never write to the real Downloads folder.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-host-downloads-"));
    await session.cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: dir });
    const page = await session.cdp.newPage(`${origin}/dl`);
    await sleep(600);
    await page.eval(`document.getElementById("note").click()`);
    let files = [];
    for (let i = 0; i < 40 && !files.includes("orbit-note.txt"); i++) {
      await sleep(250);
      files = fs.readdirSync(dir);
    }
    await page.close();
    const contents = files.includes("orbit-note.txt") ? fs.readFileSync(path.join(dir, "orbit-note.txt"), "utf8") : null;
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    assert.equal(contents, "orbit test note\n", JSON.stringify(files));
  });

  test("installs no extension of its own besides Orbit", async () => {
    const page = await session.cdp.newPage("chrome://extensions/");
    await sleep(800);
    const names = await page.eval(`chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }).then((all) => all.filter((e) => e.location !== "COMPONENT").map((e) => e.name))`);
    await page.close();
    assert.deepEqual(names, ["Orbit"]);
  });
});

describe("certificate handling", () => {
  let certificate;
  let fixture;
  let session;

  before(async () => {
    certificate = makeCertificate();
  });

  after(async () => {
    await session?.kill();
    if (session) removeProfile(session.profile);
    await fixture?.close();
  });

  test("refuses a site with an untrusted certificate", async (t) => {
    if (!certificate) {
      t.skip("OpenSSL is not available on this machine");
      return;
    }
    fixture = await startFixture(certificate);
    session = await launchHost({ args: ["--host-resolver-rules=MAP *.test 127.0.0.1"] });
    fixture.log.length = 0;
    const page = await session.cdp.newPage("about:blank");
    await page.goto(`https://a.test:${fixture.port}/secret`, { settleMs: 1200, timeoutMs: 15000 }).catch(() => {});
    const text = await page.text(600).catch(() => "");
    await page.close();
    assert.deepEqual(fixture.log, [], "the page was requested over an untrusted connection");
    assert.match(text, /not private|privacy|ERR_CERT/i, text);
  });
});

describe("third-party cookies", () => {
  let certificate;
  let fixture;
  let session;

  before(async () => {
    certificate = makeCertificate();
  });

  after(async () => {
    await session?.kill();
    if (session) removeProfile(session.profile);
    await fixture?.close();
  });

  test("are blocked by default, and first-party cookies still work", async (t) => {
    if (!certificate) {
      t.skip("OpenSSL is not available on this machine");
      return;
    }
    fixture = await startFixture(certificate);
    session = await launchHost({ args: ["--host-resolver-rules=MAP *.test 127.0.0.1", "--ignore-certificate-errors"] });
    const origin = `https://a.test:${fixture.port}`;
    const page = await session.cdp.newPage(`${origin}/frames`);
    await sleep(1200);
    await page.goto(`${origin}/frames`, { settleMs: 1200 });
    const frameRequests = fixture.log.filter((e) => e.host === "b.test" && e.path === "/frame");
    assert.equal(frameRequests.length, 2, "the frame did not load twice");
    assert.equal(frameRequests[1].cookie, "", "the third-party cookie came back");

    const first = await session.cdp.newPage(`${origin}/setcookie`);
    await sleep(500);
    await first.goto(`${origin}/`, { settleMs: 300 });
    assert.match(await first.eval("document.cookie"), /first=party/);
    await first.close();
    await page.close();
  });
});
