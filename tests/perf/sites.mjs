// Visits real websites with Shields on and reports what happened, one site at a time. It needs the
// internet and sites change, so this is a manual check rather than part of the test suite.
//   node tests/perf/sites.mjs [output.json]
// It only reads pages. It signs in to nothing and types nothing.
import fs from "node:fs";
import { launchHost, removeProfile, sleep, tempProfile } from "../host/lib/host.mjs";

const SITES = [
  { name: "Wikipedia", url: "https://en.wikipedia.org/wiki/Web_browser" },
  { name: "GitHub", url: "https://github.com/chromiumembedded/cef" },
  { name: "YouTube", url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", video: true, wait: 7000 },
  { name: "Reddit", url: "https://www.reddit.com/", wait: 5000 },
  { name: "X", url: "https://x.com/", wait: 6000 },
  { name: "BBC", url: "https://www.bbc.com/news", wait: 5000 },
  { name: "CNN", url: "https://edition.cnn.com/", wait: 6000 },
  { name: "Amazon", url: "https://www.amazon.com/", wait: 5000 },
  { name: "Stack Overflow", url: "https://stackoverflow.com/questions", wait: 4000 },
  { name: "Google Maps", url: "https://www.google.com/maps", wait: 7000 },
  { name: "Vimeo", url: "https://vimeo.com/76979871", video: true, wait: 7000 },
  { name: "Twitch", url: "https://www.twitch.tv/", video: true, wait: 8000 },
];

const VIDEO = `(async () => {
  const video = document.querySelector("video");
  if (!video) return { video: false };
  video.muted = true;
  await Promise.race([video.play().catch(() => {}), new Promise((r) => setTimeout(r, 4000))]);
  await new Promise((r) => setTimeout(r, 2500));
  return { video: true, time: Number(video.currentTime.toFixed(1)), width: video.videoWidth, error: video.error?.code ?? null };
})()`;

const session = await launchHost({ profile: tempProfile(), checkProfile: false });
await sleep(2500);
const results = [];
for (const site of SITES) {
  const page = await session.cdp.newPage("about:blank");
  const errors = [];
  const off = session.cdp.on((m) => {
    if (m.sessionId === page.sessionId && m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.text);
  });
  const entry = { name: site.name };
  const started = Date.now();
  const nav = await page.goto(site.url, { timeoutMs: 30000, settleMs: site.wait ?? 3000 }).catch((e) => ({ errorText: e.message }));
  entry.seconds = Number(((Date.now() - started - (site.wait ?? 3000)) / 1000).toFixed(1));
  if (nav.errorText) {
    entry.error = nav.errorText;
  } else {
    Object.assign(
      entry,
      await page.eval(`({
        title: document.title.slice(0, 70),
        textLength: document.body?.innerText.length ?? 0,
        elements: document.querySelectorAll("*").length,
        url: location.hostname,
      })`).catch((e) => ({ error: e.message })),
    );
    if (site.video) entry.playback = await page.eval(VIDEO).catch((e) => ({ error: e.message }));
    entry.pageExceptions = errors.length;
  }
  off();
  results.push(entry);
  console.log(JSON.stringify(entry));
  await page.close();
  await sleep(500);
}
const sw = (await session.cdp.targets()).find((t) => t.type === "service_worker" && t.url.includes("background/main.js"));
const worker = await session.cdp.page(sw.targetId);
await sleep(1200);
const stats = await worker.eval(`chrome.storage.local.get("stats").then((v) => Object.values(v.stats?.days ?? {}))`);
console.log("blocked in total", JSON.stringify(stats));
await session.kill();
await sleep(800);
removeProfile(session.profile);
if (process.argv[2]) fs.writeFileSync(process.argv[2], `${JSON.stringify({ date: new Date().toISOString(), results, stats }, null, 2)}\n`);
process.exit(0);
