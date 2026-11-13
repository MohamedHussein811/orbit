// Repeatable performance numbers for a built Orbit, each run on a new profile in a temporary folder:
//   startup   time from launch until the browser answers on DevTools with a page, median of runs
//   render    average frame time while animating 3,000 elements, and time to lay them out
//   memory    total working set of all Orbit processes with the new tab page and four pages open
//   idle CPU  CPU used by all Orbit processes over 30 seconds with those tabs open, as % of one core
// Usage: node tools/chromium/benchmark.mjs <browser> [runs] [out.json]
// Memory and CPU are read on Windows; on other systems those two are left out.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Cdp } from "./lib/cdp.mjs";

const [browser, runsArg = "5", outFile] = process.argv.slice(2);
if (!browser) {
  console.error("usage: benchmark.mjs <browser> [runs] [out.json]");
  process.exit(2);
}
const runs = Math.max(1, Number(runsArg));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const isWindows = process.platform === "win32";

function launch(profile, port) {
  return spawn(browser, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--no-first-run", "--no-default-browser-check", "--window-size=1280,800",
    // Keep painting at full rate when other windows cover Orbit, so frame times are real.
    "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
    ...(process.env.ORBIT_BENCH_FLAGS ? process.env.ORBIT_BENCH_FLAGS.split(" ") : []),
    "about:blank"], { stdio: "ignore" });
}

async function stop(child, profile) {
  child.kill();
  if (isWindows) {
    try {
      execFileSync("powershell", ["-NoProfile", "-Command", `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`]);
    } catch {}
  }
  await sleep(1500);
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}

/** Checks that the browser really uses the temporary profile before anything else happens. */
async function guard(cdp, profile) {
  const page = await cdp.newPage();
  await page.goto("chrome://version");
  if (!(await page.text(20000)).includes(path.basename(profile))) throw new Error("profile guard: chrome://version does not show the temporary profile");
  await page.close();
}

/** Total working set (bytes) and CPU seconds of every process started with this profile. */
function processTotals(profile) {
  const script = `$p = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${profile}*' }; ` +
    `$m = ($p | Measure-Object -Property WorkingSetSize -Sum).Sum; ` +
    `$c = ($p | ForEach-Object { $_.KernelModeTime + $_.UserModeTime } | Measure-Object -Sum).Sum; "$m $c $($p.Count)"`;
  const [bytes, cpu100ns, count] = execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim().split(/\s+/).map(Number);
  return { bytes, cpuSeconds: cpu100ns / 1e7, count };
}

const results = { browser: path.resolve(browser), date: new Date().toISOString(), system: `${os.type()} ${os.release()}, ${os.cpus()[0].model}, ${Math.round(os.totalmem() / 2 ** 30)} GB`, runs };

// Startup.
const startups = [];
for (let i = 0; i < runs; i++) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-bench-"));
  const port = 9600 + i;
  const started = performance.now();
  const child = launch(profile, port);
  const cdp = await Cdp.connect(port, 90000);
  while (!(await cdp.targets()).some((target) => target.type === "page")) await sleep(20);
  startups.push(Math.round(performance.now() - started));
  await guard(cdp, profile);
  cdp.close();
  await stop(child, profile);
}
results.startupMs = { median: median(startups), all: startups };

// Render, memory and idle CPU on one more profile.
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-bench-"));
const port = 9650;
const child = launch(profile, port);
const cdp = await Cdp.connect(port, 90000);
await guard(cdp, profile);

const scene = `data:text/html,${encodeURIComponent(`<!doctype html><meta charset=utf-8><title>render</title>
<style>body{margin:0;display:flex;flex-wrap:wrap}i{width:18px;height:18px;margin:2px;border-radius:50%;background:hsl(230 80% 70%)}</style><body>`)}`;
const page = await cdp.newPage();
await page.goto(scene, { settleMs: 500 });
await cdp.send("Target.activateTarget", { targetId: page.targetId });
await page.send("Page.bringToFront");
await sleep(500);
results.render = await page.eval(`(async () => {
  const start = performance.now();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 3000; i++) frag.appendChild(document.createElement("i"));
  document.body.appendChild(frag);
  document.body.offsetHeight;
  const layoutMs = performance.now() - start;
  const items = [...document.querySelectorAll("i")];
  const frames = [];
  let last = performance.now();
  await new Promise((done) => {
    let n = 0;
    const step = (now) => {
      frames.push(now - last);
      last = now;
      items.forEach((el, i) => { el.style.transform = "translateY(" + Math.sin((n + i) / 9) * 6 + "px)"; });
      if (++n < 180) requestAnimationFrame(step); else done();
    };
    requestAnimationFrame(step);
  });
  frames.shift();
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  return { layoutMs: Math.round(layoutMs), averageFrameMs: Math.round(avg * 10) / 10, fps: Math.round(1000 / avg) };
})()`);

const pages = ["chrome://newtab", "chrome://settings", "chrome://history", scene];
for (const url of pages) {
  const tab = await cdp.newPage();
  await tab.goto(url, { settleMs: 1500 }).catch(() => {});
}
await sleep(10000);

if (isWindows) {
  const before = processTotals(profile);
  await sleep(30000);
  const after = processTotals(profile);
  results.memoryMB = Math.round(after.bytes / 2 ** 20);
  results.processes = after.count;
  results.idleCpuPercent = Math.round(((after.cpuSeconds - before.cpuSeconds) / 30) * 1000) / 10;
}

cdp.close();
await stop(child, profile);

console.log(JSON.stringify(results, null, 2));
if (outFile) fs.writeFileSync(outFile, `${JSON.stringify(results, null, 2)}\n`);
