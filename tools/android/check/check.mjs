// Checks a fresh Orbit install on the running emulator and writes report.json plus a screenshot per
// step: the first launch as a user gets it, the start tab and new tabs (Orbit's page or Chromium's
// native one), the clock against the device's time settings, and a crawl that opens the app menu
// and taps every item, on a web page and on the new tab page, recording crashes.
// Usage: node check.mjs <package> <out dir>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [pkg, out] = process.argv.slice(2);
const MAIN = `${pkg}/com.google.android.apps.chrome.Main`;
const PAGE = "https://example.com/";
const ORBIT_PAGE = "chrome-extension://kceipbaiojomdibnboffoieecidpfdck/newtab/";
const MENU_BUTTON = /^(Customize and control .+|More options|Menu)$/;
const CRASH_DIALOG = /keeps stopping|has stopped|isn.t responding/i;
const report = { package: pkg, steps: [], clock: {}, menu: [] };

const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const adb = (...args) => {
  try {
    return execFileSync("adb", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 90_000 });
  } catch (e) {
    return String(e.stdout || "");
  }
};
const shell = (cmd) => adb("shell", cmd);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

function shot(name) {
  try {
    fs.writeFileSync(path.join(out, `${name}.png`), execFileSync("adb", ["exec-out", "screencap", "-p"], { timeout: 30_000, maxBuffer: 64 << 20 }));
  } catch {}
}

function nodes() {
  for (let attempt = 0; attempt < 3; attempt++) {
    shell("rm -f /sdcard/ui.xml; uiautomator dump /sdcard/ui.xml > /dev/null 2>&1");
    const xml = shell("cat /sdcard/ui.xml 2> /dev/null");
    if (!xml.includes("<hierarchy")) continue;
    const list = [];
    for (const m of xml.matchAll(/<node [^>]*>/g)) {
      const tag = m[0];
      const attr = (name) => (tag.match(new RegExp(` ${name}="([^"]*)"`)) || [])[1] || "";
      const b = attr("bounds").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
      if (!b) continue;
      const [l, t, r, btm] = b.slice(1).map(Number);
      list.push({
        text: attr("text").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"'),
        desc: attr("content-desc").replace(/&amp;/g, "&").replace(/&#39;/g, "'"),
        id: attr("resource-id"),
        cls: attr("class"),
        clickable: attr("clickable") === "true",
        l, t, r, b: btm, x: (l + r) >> 1, y: (t + btm) >> 1,
      });
    }
    return list;
  }
  return [];
}
const label = (n) => n.text || n.desc;
const texts = (list) => [...new Set(list.map(label).filter(Boolean))];
const tap = (n) => shell(`input tap ${n.x} ${n.y}`);

async function tapLabel(pattern, seconds = 8) {
  for (let i = 0; i <= seconds; i += 2) {
    const n = nodes().find((node) => pattern.test(label(node)));
    if (n) {
      tap(n);
      return label(n);
    }
    await sleep(2);
  }
  return null;
}

const crashText = () => shell("logcat -d -b crash");
const activity = () => (shell("dumpsys activity activities").match(/topResumedActivity=[^\n]*|mResumedActivity: [^\n]*/) || [""])[0].trim();
const alive = () => shell(`pidof ${pkg}`).trim();

async function targets() {
  try {
    const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
    return list.filter((t) => t.type === "page").map((t) => t.url);
  } catch {
    return [];
  }
}

async function evaluate(urlPrefix, expression) {
  let target;
  for (let i = 0; i < 20 && !target; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
      target = list.find((t) => t.type === "page" && t.url.startsWith(urlPrefix));
    } catch {}
    if (!target) await sleep(1);
  }
  if (!target) return { error: `no target ${urlPrefix}` };
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  const reply = new Promise((resolve) => {
    ws.onmessage = (m) => resolve(JSON.parse(m.data));
  });
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } }));
  const result = await Promise.race([reply, sleep(15).then(() => ({ error: "timeout" }))]);
  ws.close();
  return result?.result?.result?.value ?? result;
}

async function step(name, extra = {}) {
  await sleep(1);
  shot(name);
  const list = nodes();
  const entry = { name, activity: activity(), tabs: await targets(), texts: texts(list).slice(0, 40), ...extra };
  entry.nativeNtp = list.some((n) => /ntp|search_provider_logo|tile_view|mv_tiles/.test(n.id));
  report.steps.push(entry);
  console.log(`[${name}] ${entry.activity}\n  tabs: ${entry.tabs.join(" | ")}\n  native NTP views: ${entry.nativeNtp}\n  text: ${entry.texts.slice(0, 14).join(" / ")}`);
  return list;
}

async function openMenu() {
  for (let i = 0; i < 4; i++) {
    const button = nodes().find((n) => MENU_BUTTON.test(n.desc));
    if (button) {
      tap(button);
      await sleep(2);
      return true;
    }
    await sleep(2);
  }
  return false;
}

// The menu's rows (text) and its icon row (content descriptions), scrolling through long menus.
async function menuItems() {
  const found = [];
  if (!(await openMenu())) return found;
  for (let page = 0; page < 6; page++) {
    const list = nodes();
    const menu = list.find((n) => /app_menu_list$/.test(n.id));
    if (!menu) break;
    const inside = list.filter((n) => n.y > menu.t && n.y < menu.b && n.x > menu.l && n.x < menu.r);
    let added = 0;
    for (const n of inside) {
      const name = n.text || (n.clickable && n.desc) || "";
      if (name && !found.includes(name) && !/^\d+$/.test(name)) {
        found.push(name);
        added++;
      }
    }
    if (!added && page) break;
    shell(`input swipe ${menu.x} ${menu.b - 60} ${menu.x} ${menu.t + 60} 400`);
    await sleep(1.5);
  }
  shell("input keyevent KEYCODE_BACK");
  return found;
}

async function findInMenu(name) {
  for (let page = 0; page < 6; page++) {
    const list = nodes();
    const n = list.find((node) => node.text === name || node.desc === name);
    if (n) return n;
    const menu = list.find((node) => /app_menu_list$/.test(node.id));
    if (!menu) return null;
    shell(`input swipe ${menu.x} ${menu.b - 60} ${menu.x} ${menu.t + 60} 400`);
    await sleep(1.5);
  }
  return null;
}

async function launch(url) {
  shell(`am force-stop ${pkg}`);
  await sleep(1);
  if (url) shell(`am start -W -a android.intent.action.VIEW -d '${url}' -n ${MAIN}`);
  else shell(`am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${MAIN}`);
  await sleep(10);
}

async function dismissCrashDialog() {
  const list = nodes();
  if (!list.some((n) => CRASH_DIALOG.test(label(n)))) return false;
  const close = list.find((n) => /^(Close app|OK|Close)$/i.test(label(n)));
  if (close) tap(close);
  else shell("input keyevent KEYCODE_BACK");
  await sleep(2);
  return true;
}

async function newTabFromMenu() {
  if (!(await openMenu())) return null;
  const item = await findInMenu("New tab");
  if (!item) {
    shell("input keyevent KEYCODE_BACK");
    return null;
  }
  tap(item);
  await sleep(8);
  return true;
}

async function firstRun() {
  shell(`am start -W -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${MAIN}`);
  await sleep(20);
  let list = await step("01-first-launch");
  // Walk through anything Chromium shows before the browser, recording each screen.
  for (let i = 0; i < 6; i++) {
    const words = texts(list).join(" ");
    if (!/Welcome to|Terms of Service|sends usage|Sign in|Turn on sync|notifications make things easier|send you notifications|search engine/i.test(words)) break;
    const pressed = await tapLabel(/^(No thanks|Use without an account|Not now|Skip|Don.t allow|Continue|Accept & continue|Set as default|OK)$/, 4);
    report.steps.at(-1).pressed = pressed;
    await sleep(6);
    list = await step(`01-first-launch-${i + 2}`);
  }
}

async function newTabPages() {
  await sleep(20);
  await step("02-start-tab-after-30s");
  if (await newTabFromMenu()) await step("03-new-tab");
  await launch(null);
  await step("04-relaunch");
  if (await newTabFromMenu()) await step("05-new-tab-after-relaunch");
  const home = nodes().find((n) => /^Home$|Open the home page/.test(n.desc));
  if (home) {
    tap(home);
    await sleep(6);
    await step("06-home-button");
  }
}

async function clock() {
  const device = () => ({
    date: shell("date").trim(),
    timezone: shell("getprop persist.sys.timezone").trim(),
    locale: shell("getprop persist.sys.locale").trim() || shell("getprop ro.product.locale").trim(),
    time_12_24: shell("settings get system time_12_24").trim(),
  });
  const page = `(async () => ({
    shown: document.getElementById("time")?.innerText ?? null,
    now: new Date().toString(),
    iso: new Date().toISOString(),
    offsetMinutes: new Date().getTimezoneOffset(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: Intl.DateTimeFormat().resolvedOptions().locale,
    hourCycle: new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions().hourCycle ?? null,
    uiLanguage: chrome.i18n.getUILanguage(),
    languages: navigator.languages,
    settings: (await chrome.storage.local.get("settings")).settings ?? null,
  }))()`;
  report.clock.device12h = device();
  report.clock.page12h = await evaluate(ORBIT_PAGE, page);
  shell("settings put system time_12_24 24");
  await evaluate(ORBIT_PAGE, "location.reload()");
  await sleep(5);
  report.clock.device24h = device();
  report.clock.page24h = await evaluate(ORBIT_PAGE, page);
  shot("07-clock-device-24h");
  shell("settings put system time_12_24 12");
  console.log(`clock: ${JSON.stringify(report.clock, null, 1)}`);
}

async function crawl(context) {
  const prepare = async () => {
    if (context === "page") await launch(PAGE);
    else {
      await launch(null);
      await newTabFromMenu();
    }
  };
  await prepare();
  const items = await menuItems();
  console.log(`menu (${context}): ${items.join(" / ")}`);
  report[`menuItems_${context}`] = items;
  for (const [index, name] of items.entries()) {
    await prepare();
    const before = crashText().length;
    const entry = { context, name, opened: false };
    if (await openMenu()) {
      const item = await findInMenu(name);
      if (item) {
        tap(item);
        entry.opened = true;
        await sleep(6);
      }
    }
    entry.shot = `menu-${context}-${String(index).padStart(2, "0")}-${slug(name)}`;
    shot(entry.shot);
    const list = nodes();
    entry.activity = activity();
    entry.texts = texts(list).slice(0, 20);
    entry.crashDialog = list.some((n) => CRASH_DIALOG.test(label(n)));
    const crash = crashText().slice(before);
    entry.crashed = entry.crashDialog || crash.includes("FATAL EXCEPTION") || crash.includes("Fatal signal") || !alive();
    entry.crash = crash.split("\n").filter((l) => /FATAL|Exception|Error|at |Caused by|signal/.test(l)).slice(0, 25).map((l) => l.replace(/^.*?(?:AndroidRuntime|DEBUG|libc)\s*:\s?/, ""));
    report.menu.push(entry);
    console.log(`${entry.crashed ? "CRASH" : "ok   "} [${context}] ${name} -> ${entry.activity.replace(/.*\{[^ ]+ [^ ]+ /, "").slice(0, 90)}`);
    if (entry.crashed) console.log(`  ${entry.crash.slice(0, 8).join("\n  ")}`);
    await dismissCrashDialog();
  }
}

fs.mkdirSync(out, { recursive: true });
const save = () => fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 1));
try {
  await firstRun();
  save();
  await newTabPages();
  save();
  await clock();
  save();
  await crawl("page");
  save();
  await crawl("ntp");
} catch (e) {
  report.error = String(e?.stack || e);
  console.log(report.error);
}
save();
const crashes = report.menu.filter((m) => m.crashed);
console.log(`\n${report.menu.length} menu items tapped, ${crashes.length} crashed: ${crashes.map((m) => `${m.context}:${m.name}`).join(", ") || "none"}`);
const notOpened = report.menu.filter((m) => !m.opened);
if (notOpened.length) console.log(`not found when tapping: ${notOpened.map((m) => `${m.context}:${m.name}`).join(", ")}`);
