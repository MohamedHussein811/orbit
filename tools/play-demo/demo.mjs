// Records one short video per Android permission Google Play asks about, on the running emulator.
// Each video starts by launching Orbit and shows the feature that needs the permission.
// Usage: node demo.mjs <package> <out dir>
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [pkg, out] = process.argv.slice(2);
const PAGE = "http://localhost:8000/";
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));
const adb = (...args) => execFileSync("adb", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const shell = (cmd) => {
  try { return adb("shell", cmd); } catch (e) { return String(e.stdout || ""); }
};

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch("http://127.0.0.1:9222/json/list")).json();
      const page = list.find((t) => t.type === "page" && t.url.startsWith(PAGE));
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(1);
  }
  throw new Error("demo page not found over DevTools");
}

async function run(expression) {
  const ws = new WebSocket(await target());
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const done = new Promise((resolve) => { ws.onmessage = (m) => resolve(JSON.parse(m.data)); });
  ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression, userGesture: true } }));
  const reply = await Promise.race([done, sleep(10)]);
  ws.close();
  return reply;
}
const say = (text) => run(`say(${JSON.stringify(text)})`);
const click = (id) => run(`document.getElementById(${JSON.stringify(id)}).click()`);

function screenNodes() {
  shell("uiautomator dump /sdcard/ui.xml > /dev/null 2>&1");
  const xml = shell("cat /sdcard/ui.xml");
  const nodes = [];
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const tag = m[0];
    const text = (tag.match(/ text="([^"]*)"/) || [])[1] || "";
    const desc = (tag.match(/ content-desc="([^"]*)"/) || [])[1] || "";
    const b = tag.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (b) nodes.push({ label: text || desc, x: (+b[1] + +b[3]) >> 1, y: (+b[2] + +b[4]) >> 1 });
  }
  return nodes;
}

async function tapText(pattern, seconds = 10) {
  for (let i = 0; i < seconds; i += 2) {
    const node = screenNodes().find((n) => pattern.test(n.label));
    if (node) {
      console.log(`tap "${node.label}"`);
      shell(`input tap ${node.x} ${node.y}`);
      return true;
    }
    await sleep(2);
  }
  console.log(`no ${pattern} on screen`);
  return false;
}

async function launch() {
  shell(`am force-stop ${pkg}`);
  await sleep(2);
  shell(`am start -a android.intent.action.VIEW -d ${PAGE} -n ${pkg}/com.google.android.apps.chrome.Main`);
  await target();
  await sleep(4);
}

async function home(caption) {
  shell("input keyevent KEYCODE_HOME");
  await sleep(3);
  shell("cmd statusbar expand-notifications");
  console.log(caption);
  await sleep(9);
  shell("cmd statusbar collapse");
  await sleep(1);
}

async function record(name, steps) {
  console.log(`== ${name}`);
  shell("input keyevent KEYCODE_HOME");
  await sleep(2);
  const recorder = spawn("adb", ["shell", "screenrecord", "--bit-rate", "6000000", `/sdcard/${name}.mp4`], { stdio: "ignore" });
  await sleep(2);
  try {
    await steps();
  } catch (e) {
    console.log(`${name}: ${e.message}`);
  }
  await sleep(2);
  shell("pkill -INT screenrecord");
  await sleep(3);
  recorder.kill();
  adb("pull", `/sdcard/${name}.mp4`, path.join(out, `${name}.mp4`));
  shell(`am force-stop ${pkg}`);
}

fs.mkdirSync(out, { recursive: true });

await record("1-query-all-packages", async () => {
  await launch();
  await say("QUERY_ALL_PACKAGES: a link meant for another app (here a phone number) opens in the installed app that handles it.");
  await sleep(4);
  await click("tel");
  await sleep(7);
  shell("input keyevent KEYCODE_BACK");
  await sleep(4);
});

await record("2-request-install-packages", async () => {
  await launch();
  await say("REQUEST_INSTALL_PACKAGES: an app file the user downloads in the browser can be opened to install it.");
  await sleep(4);
  await click("apk");
  await tapText(/^(Download|Download anyway|Keep)$/i, 8);
  await sleep(4);
  await tapText(/^Open$/i, 12);
  await sleep(4);
  await tapText(/^Settings$/i, 8);
  await sleep(6);
});

await record("4-media-playback", async () => {
  await launch();
  await say("FOREGROUND_SERVICE_MEDIA_PLAYBACK: audio from a page keeps playing, with media controls, after the user leaves the browser.");
  await sleep(4);
  await click("play");
  await sleep(6);
  await home("media notification");
});

await record("5-camera-microphone", async () => {
  await launch();
  await say("FOREGROUND_SERVICE_CAMERA and FOREGROUND_SERVICE_MICROPHONE: a video call in a web page keeps the camera and microphone, with a notification, when the user switches apps.");
  await sleep(4);
  await click("camera");
  await tapText(/^Allow/i, 10);
  await sleep(2);
  await tapText(/^Allow/i, 4);
  await sleep(7);
  await home("camera and microphone notification");
});

await record("6-data-sync-download", async () => {
  await launch();
  await say("FOREGROUND_SERVICE_DATA_SYNC: a large download keeps running with a notification after the user leaves the browser.");
  await sleep(4);
  await click("big");
  await tapText(/^(Download|Download anyway|Keep)$/i, 6);
  await sleep(6);
  await home("download notification");
});
