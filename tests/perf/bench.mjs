// Repeatable measurements of the built host on this machine. Numbers vary by machine, so they are
// reported rather than asserted. Compare runs on one machine only.
//   node tests/perf/bench.mjs [output.json]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { startFixture } from "../host/lib/fixture.mjs";
import { hostProcesses, launchHost, removeProfile, sleep, tempProfile, waitForExit } from "../host/lib/host.mjs";

const EXTENSION_ID = "boccmnigbogdpajphlpgodcalflpinmk";
const RUNS = 5;
const IDLE_SECONDS = 30;
const TABS = 10;

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Sums working set and CPU time across the browser's processes. */
function usage(session) {
  const pids = [...new Set([session.pid, ...hostProcesses(session.variant, session.profile).map((p) => p.pid)])];
  if (process.platform === "win32") {
    const json = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Get-Process -Id ${pids.join(",")} -ErrorAction SilentlyContinue | Select-Object WorkingSet64,CPU | ConvertTo-Json -Compress`],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    const parsed = [json.trim() ? JSON.parse(json) : []].flat();
    return { processes: parsed.length, memoryMb: parsed.reduce((sum, p) => sum + p.WorkingSet64, 0) / 1048576, cpuSeconds: parsed.reduce((sum, p) => sum + (p.CPU ?? 0), 0) };
  }
  const text = execFileSync("ps", ["-o", "rss=,time=", "-p", pids.join(",")], { encoding: "utf8" });
  let memoryKb = 0;
  let cpuSeconds = 0;
  let processes = 0;
  for (const line of text.trim().split("\n")) {
    const [rss, time] = line.trim().split(/\s+/);
    memoryKb += Number(rss);
    cpuSeconds += time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
    processes++;
  }
  return { processes, memoryMb: memoryKb / 1024, cpuSeconds };
}

async function dashboardReady(session) {
  for (let i = 0; i < 400; i++) {
    const target = (await session.pages()).find((t) => t.url === "chrome://newtab/");
    if (target) {
      const page = await session.cdp.page(target.targetId);
      const ready = await page.eval(`location.href.startsWith("chrome-extension://${EXTENSION_ID}") && document.querySelector(".widget") !== null`).catch(() => false);
      if (ready) return page;
    }
    await sleep(25);
  }
  throw new Error("the dashboard did not appear");
}

async function coldStart() {
  const profile = tempProfile();
  const first = await launchHost({ profile, checkProfile: false });
  await dashboardReady(first);
  await sleep(14000);
  await first.closeWindows();
  await waitForExit(first).catch(() => {});
  await first.kill();
  await sleep(1000);

  const times = [];
  for (let i = 0; i < RUNS; i++) {
    const started = performance.now();
    const session = await launchHost({ profile, checkProfile: false });
    await dashboardReady(session);
    times.push(Math.round(performance.now() - started));
    await sleep(1500);
    await session.closeWindows();
    await waitForExit(session).catch(() => {});
    await session.kill();
    await sleep(1000);
  }
  removeProfile(profile);
  return { runs: times, medianMs: median(times) };
}

async function steadyState(fixture) {
  const session = await launchHost({ profile: tempProfile(), checkProfile: false });
  const results = {};
  try {
    await dashboardReady(session);
    await sleep(10000);
    const idleStart = usage(session);
    await sleep(IDLE_SECONDS * 1000);
    const idleEnd = usage(session);
    results.dashboardOnly = {
      processes: idleEnd.processes,
      memoryMb: Math.round(idleEnd.memoryMb),
      idleCpuPercentOfOneCore: Number((((idleEnd.cpuSeconds - idleStart.cpuSeconds) / IDLE_SECONDS) * 100).toFixed(2)),
    };

    const origin = `http://localhost:${fixture.port}`;
    const switches = [];
    const pages = [];
    for (let i = 0; i < TABS; i++) pages.push(await session.cdp.newPage(`${origin}/?tab=${i}`));
    await sleep(5000);
    for (const page of pages) {
      const started = performance.now();
      await page.send("Page.bringToFront");
      await page.eval("document.visibilityState");
      switches.push(performance.now() - started);
    }
    const loaded = usage(session);
    results.withTabs = { tabs: TABS, processes: loaded.processes, memoryMb: Math.round(loaded.memoryMb), medianTabSwitchMs: Math.round(median(switches)) };

    const opens = [];
    for (let i = 0; i < 5; i++) {
      const started = performance.now();
      const page = await session.cdp.newPage("about:blank");
      await page.goto(`${origin}/?open=${i}`, { settleMs: 0 });
      opens.push(performance.now() - started);
      await page.close();
    }
    results.openAndLoadTabMedianMs = Math.round(median(opens));
  } finally {
    await session.kill();
    await sleep(800);
    removeProfile(session.profile);
  }
  return results;
}

const fixture = await startFixture();
const report = {
  date: new Date().toISOString(),
  machine: { platform: process.platform, arch: process.arch, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, memoryGb: Math.round(os.totalmem() / 1024 ** 3) },
  coldStartToDashboard: await coldStart(),
  ...(await steadyState(fixture)),
};
await fixture.close();
console.log(JSON.stringify(report, null, 2));
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
process.exit(0);
