// Screenshots of a built Orbit's real window (Windows only), for design review. Starts Orbit with a
// new profile in a temporary folder and captures only Orbit's own windows, never the screen.
//   node tools/chromium/window-shots.mjs <chrome.exe> <out dir> <language> <scene,...>
// Scenes: space, dark, light (Settings and the new tab page in that theme), error, history,
// privacy. Private windows come out blank this way. Loading two news sites first makes the
// Shields counts real.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp } from "../../tests/host/lib/cdp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SHOT = path.join(ROOT, "tests/host/lib/window-shot.ps1");
const ID = "kceipbaiojomdibnboffoieecidpfdck";
const [browser, outDir, lang = "en", scenesArg = "space"] = process.argv.slice(2);
if (!browser || !outDir) {
  console.error("usage: window-shots.mjs <chrome.exe> <out dir> <language> <scene,...>");
  process.exit(2);
}
const scenes = scenesArg.split(",");
const arabic = lang.startsWith("ar");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
fs.mkdirSync(outDir, { recursive: true });

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-shots-"));
const port = 9555;
const child = spawn(
  browser,
  [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--lang=${lang}`,
    "--window-size=1440,900",
    "--window-position=40,40",
    "about:blank",
  ],
  { stdio: "ignore" },
);

function shoot(name) {
  const out = execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SHOT, "-ProcessIds", String(child.pid), "-OutPrefix", path.join(outDir, `${lang}-${name}`)],
    { encoding: "utf8" },
  );
  console.log(out.trim());
}

const cdp = await Cdp.connect(port, 90000);

/** Leaves exactly these tabs open, in this order, with the last one in front. */
async function showTabs(urls) {
  for (const target of await cdp.targets()) {
    if (target.type === "page") await cdp.send("Target.closeTarget", { targetId: target.targetId }).catch(() => {});
  }
  let page;
  for (const url of urls) {
    page = await cdp.newPage("about:blank");
    await page.goto(url, { settleMs: 2500 }).catch(() => {});
  }
  await cdp.send("Target.activateTarget", { targetId: page.targetId });
  await sleep(2500);
  return page;
}

try {
  const guard = await cdp.newPage();
  await guard.goto("chrome://version");
  if (!(await guard.text(20000)).includes(path.basename(profile))) throw new Error("profile guard: chrome://version does not show the temporary profile");
  await guard.close();

  let ntp;
  for (let i = 0; i < 18; i++) {
    await sleep(i === 0 ? 2000 : 10000);
    await ntp?.close();
    ntp = await cdp.newPage("about:blank");
    await ntp.goto("chrome://newtab", { settleMs: 1500 });
    if ((await ntp.eval("location.href")).startsWith(`chrome-extension://${ID}/`)) break;
  }
  console.log("new tab:", await ntp.eval("location.href"));
  const work = arabic ? "العمل" : "Work";
  const city = arabic ? "القاهرة" : "Cairo";
  const note = arabic ? "تجديد جواز السفر قبل مارس" : "Renew passport before March";
  await ntp.eval(`(async () => {
    const sites = [["DuckDuckGo", "https://duckduckgo.com/"], ["Wikipedia", "https://www.wikipedia.org/"], ["GitHub", "https://github.com/"], ["OpenStreetMap", "https://www.openstreetmap.org/"], ["The Guardian", "https://www.theguardian.com/"], ["MDN", "https://developer.mozilla.org/"]];
    for (const [title, url] of sites) await chrome.bookmarks.create({ parentId: "1", title, url });
    await chrome.bookmarks.create({ parentId: "1", title: ${JSON.stringify(work)} });
    const now = Date.now();
    await chrome.storage.local.set({
      weatherPlace: { name: ${JSON.stringify(city)}, detail: "Egypt", latitude: 30.04, longitude: 31.24 },
      notes: [{ id: "a", text: ${JSON.stringify(note)}, color: "amber", pinned: true, created: now, updated: now }],
    });
  })()`);

  const browse = await cdp.newPage("about:blank");
  for (const url of ["https://www.theguardian.com/international", "https://edition.cnn.com/"]) {
    await browse.goto(url, { timeoutMs: 45000, settleMs: 6000 }).catch((error) => console.log("browse:", error.message));
  }

  const setTheme = async (theme) => {
    const settings = await cdp.newPage("about:blank");
    await settings.goto("chrome://settings/appearance", { settleMs: 1000 });
    await settings.eval(`chrome.send("setOrbitTheme", [${JSON.stringify(theme)}])`);
    await sleep(1500);
  };

  for (const scene of scenes) {
    if (["space", "dark", "light"].includes(scene)) {
      await setTheme(scene);
      await showTabs(["https://duckduckgo.com/", "chrome://settings/appearance"]);
      shoot(`${scene}-settings`);
      await showTabs(["https://duckduckgo.com/", "chrome://settings/appearance", "chrome://newtab"]);
      shoot(`${scene}-newtab`);
    } else if (scene === "error") {
      await showTabs(["chrome://newtab", "https://orbit-test.invalid/"]);
      shoot("error");
    } else if (scene === "history") {
      await showTabs(["chrome://newtab", "chrome://history"]);
      shoot("history");
    } else if (scene === "privacy") {
      await showTabs(["chrome://newtab", `chrome-extension://${ID}/privacy/privacy.html`]);
      shoot("privacy");
    }
  }
} catch (error) {
  console.log(`FAIL ${error.message}`);
} finally {
  cdp.close();
  child.kill();
  setTimeout(() => fs.rmSync(profile, { recursive: true, force: true }), 3000);
}
