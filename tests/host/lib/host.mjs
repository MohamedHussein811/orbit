// Starts the built Orbit host on a throwaway profile and drives it through DevTools.
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDir } from "../../../tools/build-host.mjs";
import { Cdp } from "./cdp.mjs";

const LIB = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_PREFIX = "orbit-host-";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function binaryPath(variant) {
  const dir = path.join(buildDir(), variant);
  if (process.platform === "win32") return path.join(dir, `${variant}.exe`);
  if (process.platform === "darwin") {
    const name = variant === "orbit" ? "Orbit" : "OrbitTest";
    return path.join(dir, `${name}.app`, "Contents", "MacOS", name);
  }
  return path.join(dir, variant);
}

export function tempProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
}

export function removeProfile(dir) {
  const inside = path.resolve(dir).toLowerCase().startsWith(path.resolve(os.tmpdir()).toLowerCase());
  if (!inside || !path.basename(dir).startsWith(PROFILE_PREFIX)) throw new Error(`refusing to remove ${dir}`);
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 500 });
  } catch (e) {
    console.log(`profile left behind: ${e.code} ${dir}`);
  }
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

export function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => resolve(false));
  });
}

/** Process ids whose command line or main process belongs to this profile. */
export function hostProcesses(variant, profile) {
  const name = path.basename(binaryPath(variant));
  if (process.platform === "win32") {
    const json = execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Get-CimInstance Win32_Process -Filter "Name='${name}'" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress`],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (!json.trim()) return [];
    const parsed = JSON.parse(json);
    return (Array.isArray(parsed) ? parsed : [parsed])
      .filter((p) => p.CommandLine?.includes(path.basename(profile)))
      .map((p) => ({ pid: p.ProcessId, commandLine: p.CommandLine }));
  }
  const text = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return text
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((m) => m && m[2].includes(name) && m[2].includes(path.basename(profile)))
    .map((m) => ({ pid: Number(m[1]), commandLine: m[2] }));
}

async function assertIsolated(cdp, profile) {
  const page = await cdp.newPage("chrome://version/");
  await sleep(800);
  const text = await page.text(6000);
  await page.close();
  const line = text.split("\n").find((l) => l.startsWith("Profile Path")) ?? "";
  if (!line.toLowerCase().replaceAll("/", path.sep).includes(path.resolve(profile).toLowerCase())) {
    throw new Error(`host is not using the test profile: ${line}`);
  }
}

/**
 * Starts a variant. orbit_test also opens DevTools and is checked against the profile before the
 * caller gets control. The production variant ignores switches, so only `urls` reach it.
 */
export async function launchHost({ variant = "orbit_test", profile = tempProfile(), args = [], urls = [], connect = variant === "orbit_test", checkProfile = true, env = {} } = {}) {
  const port = connect ? await freePort() : null;
  const devtools = connect ? [`--remote-debugging-port=${port}`, "--remote-allow-origins=*"] : [];
  // The macOS keychain would otherwise block a test run with a prompt.
  if (connect && process.platform === "darwin") devtools.push("--use-mock-keychain");
  const child = spawn(binaryPath(variant), [...devtools, ...args, ...urls], {
    detached: true,
    stdio: "ignore",
    env: { ...process.env, ...env, ORBIT_USER_DATA_DIR: profile },
  });
  const session = { child, variant, profile, port, pid: child.pid, cdp: null, exit: null };
  session.exited = new Promise((resolve) => {
    child.on("exit", (code, signal) => { session.exit = { code, signal }; resolve(session.exit); });
  });
  child.on("error", (e) => { session.exit = { error: e.message }; });
  child.unref();
  session.kill = () => killHost(session);
  session.pages = async () => (await session.cdp.targets()).filter((t) => t.type === "page");
  session.input = (keys, options) => postInput(session, keys, options);
  session.shot = (file) => windowShot(session, file);
  session.closeWindows = () => closeWindows(session);
  if (connect) {
    try {
      session.cdp = await Cdp.connect(port);
      if (checkProfile) await assertIsolated(session.cdp, profile);
    } catch (e) {
      await session.kill();
      throw e;
    }
  }
  return session;
}

/** Hard kill of the main process, which is what a crash looks like to the next launch. */
export async function killHost(session) {
  try { session.cdp?.close(); } catch {}
  if (session.exit) return session.exit;
  try {
    process.kill(session.pid, "SIGKILL");
  } catch {}
  await Promise.race([session.exited, sleep(5000)]);
  await sleep(500);
  for (const p of hostProcesses(session.variant, session.profile)) {
    try { process.kill(p.pid, "SIGKILL"); } catch {}
  }
  return session.exit;
}

/** Waits for a clean exit, and fails loudly if the host does not stop. */
export async function waitForExit(session, timeoutMs = 20000) {
  const result = await Promise.race([session.exited, sleep(timeoutMs).then(() => null)]);
  if (!result) throw new Error(`host still running after ${timeoutMs} ms`);
  try { session.cdp?.close(); } catch {}
  await sleep(500);
  return result;
}

function postInput(session, keys, { titleLike = "", smallest = false } = {}) {
  if (process.platform !== "win32") throw new Error("window input is only implemented on Windows");
  const pids = hostProcesses(session.variant, session.profile).map((p) => p.pid).concat(session.pid);
  return execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(LIB, "send-keys.ps1"), "-ProcessIds", [...new Set(pids)].join(","), "-Keys", keys, "-TitleLike", titleLike, ...(smallest ? ["-Smallest"] : [])],
    { encoding: "utf8" },
  ).trim();
}

function windowShot(session, file) {
  if (process.platform !== "win32") return "window capture is only implemented on Windows";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(LIB, "window-shot.ps1"), "-ProcessIds", String(session.pid), "-OutPrefix", file],
    { encoding: "utf8" },
  ).trim();
}

/** Closes the browser as a whole, which records the open window for restore. Windows posts WM_CLOSE. */
async function closeWindows(session) {
  if (process.platform === "win32") {
    for (let i = 0; i < 12 && !session.exit; i++) {
      const result = postInput(session, "close");
      if (result === "no window") break;
      await sleep(700);
    }
    return;
  }
  await session.cdp.send("Browser.close", {}, undefined, 8000).catch(() => {});
}

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export const profilePreferences = (profile) => readJson(path.join(profile, "Default", "Preferences"));
export const securePreferences = (profile) => readJson(path.join(profile, "Default", "Secure Preferences"));
export const localState = (profile) => readJson(path.join(profile, "Local State"));

/** Dotted lookup in a preferences object. */
export function pref(object, dotted) {
  return dotted.split(".").reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), object);
}
