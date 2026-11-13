// Checks a built Orbit browser through the DevTools protocol: privacy defaults, Settings data, the
// built-in extension and its new tab page. Uses a new profile in a temporary folder.
//   node tools/chromium/check-browser.mjs <browser> <extension id> [extra browser flags...]
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Cdp } from "./lib/cdp.mjs";

const [browser, extensionId, ...extraFlags] = process.argv.slice(2);
if (!browser || !extensionId) {
  console.error("usage: check-browser.mjs <browser> <extension id> [extra browser flags...]");
  process.exit(2);
}

const port = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-check-"));
const child = spawn(
  browser,
  [
    "--headless",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    ...extraFlags,
    "about:blank",
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let log = "";
child.stderr.on("data", (chunk) => {
  log += chunk;
});

const failures = [];
function expect(name, actual, wanted) {
  const ok = JSON.stringify(actual) === JSON.stringify(wanted);
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(actual)}${ok ? "" : ` (wanted ${JSON.stringify(wanted)})`}`);
  if (!ok) failures.push(name);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pageJson(page, url) {
  await page.goto(url);
  const text = await page.eval("document.body ? document.body.innerText : ''");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${url} did not return JSON: ${text.slice(0, 300)}`);
  }
}

let cdp;
try {
  cdp = await Cdp.connect(port, 90000);
  const page = await cdp.newPage();

  const prefs = await pageJson(page, "chrome://prefs-internals");
  const value = (entry) => entry?.value;
  expect("HTTPS only", value(prefs.https_only_mode_enabled), true);
  expect("page preloading", value(prefs.net?.network_prediction_options), 2);
  expect("Safe Browsing", value(prefs.safebrowsing?.enabled), false);
  expect("search suggestions", value(prefs.search?.suggest_enabled), false);
  expect("translation", value(prefs.translate?.enabled), false);
  expect("sign-in", value(prefs.signin?.allowed), false);
  expect("third-party cookies", value(prefs.profile?.cookie_controls_mode), 1);
  expect("first search engine", value(prefs.search_provider_overrides)?.[0]?.keyword, "duckduckgo.com");

  await page.goto("chrome://settings");
  const settingsPref = (key) =>
    page.eval(`new Promise((resolve) => chrome.settingsPrivate.getPref(${JSON.stringify(key)}, (pref) => resolve(pref?.value)))`);
  expect("secure DNS mode", await settingsPref("dns_over_https.mode"), "secure");
  expect("secure DNS server", await settingsPref("dns_over_https.templates"), "https://dns.quad9.net/dns-query");
  const settingsValue = (key) =>
    page.eval(`import("chrome://resources/js/load_time_data.js").then(({ loadTimeData }) => loadTimeData.getValue(${JSON.stringify(key)}))`);
  expect("Settings AI page", await settingsValue("showAiPage"), false);
  expect("Settings Privacy Guide", await settingsValue("showPrivacyGuide"), false);

  const engines = await page.eval(
    `import("chrome://resources/js/cr.js").then((cr) => cr.sendWithPromise("getSearchEnginesList")).then((list) => list.defaults.map((e) => ({ name: e.name, isDefault: e.default })))`,
  );
  expect("search engines offered", engines.map((e) => e.name), ["DuckDuckGo", "Google", "Bing", "Ecosia"]);
  expect("default search engine", engines.find((e) => e.isDefault)?.name, "DuckDuckGo");

  expect("default color scheme follows the device", value(prefs.browser?.theme?.color_scheme2), 0);

  const prefix = `chrome-extension://${extensionId}/`;
  // The extension installs about 20 seconds after a first start. Opening new tab pages every few
  // seconds held the install back, so tries are 10 seconds apart, each in a new tab.
  let newTab = "";
  let tab;
  for (let i = 0; i < 18 && !newTab.startsWith(prefix); i++) {
    await sleep(10000);
    await tab?.close();
    tab = await cdp.newPage("about:blank");
    await tab.goto("chrome://newtab", { settleMs: 1000 });
    newTab = await tab.eval("location.href");
  }
  expect("new tab page", newTab, `${prefix}newtab/newtab.html`);
  const rulesets = await tab.eval("chrome.declarativeNetRequest.getEnabledRulesets().then((ids) => ids.sort())");
  expect("Shields rule lists", rulesets, ["ads", "threats", "trackers"]);

  // A local page that asks for a script from an ad server on the ads list. Shields blocks it before
  // it reaches the network, and the block must show up in the dashboard's counts.
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    response.end('<!doctype html><title>Orbit check</title><script src="https://adnxs.com/orbit-check.js"></script>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const adPage = await cdp.newPage("about:blank");
  await adPage.goto(`http://127.0.0.1:${server.address().port}/`, { settleMs: 3000 });
  server.close();
  const adsCounted = await tab.eval(
    "chrome.storage.local.get('stats').then(({ stats }) => Object.values(stats?.days ?? {}).reduce((sum, day) => sum + (day.ads ?? 0), 0))",
  );
  expect("Shields counts a blocked ad request", adsCounted > 0, true);

  await page.goto("chrome://extensions");
  const listed = await page.eval(
    "new Promise((resolve) => chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true }, (list) => resolve(list.map((e) => e.id))))",
  );
  expect("no extensions from other programs", listed, []);
  expect("blocks extensions registered for other browsers", value(prefs.extensions?.block_external_extensions), true);
} catch (error) {
  console.log(`FAIL ${error.message}`);
  failures.push(error.message);
} finally {
  cdp?.close();
  child.kill();
}

for (const line of log.split("\n")) {
  if (line.includes("No Orbit default")) {
    console.log(`FAIL ${line.trim()}`);
    failures.push(line);
  }
}
if (failures.length) {
  console.log(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("all browser checks passed");
process.exit(0);
