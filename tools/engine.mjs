// Manages the pinned CEF distribution in engine/engine.json.
//   node tools/engine.mjs pin [cef_version]   Pin the newest stable build, or a named one
//   node tools/engine.mjs fetch [platform]    Download, verify and unpack, then print CEF_ROOT
//   node tools/engine.mjs check               Report whether a newer stable build exists
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = path.join(ROOT, "engine", "engine.json");
const CACHE = path.join(ROOT, ".cache", "engine");
const BASE = "https://cef-builds.spotifycdn.com";
const PLATFORMS = ["windows64", "windowsarm64", "macosarm64", "macosx64", "linux64", "linuxarm64"];

export function currentPlatform() {
  const arm = os.arch() === "arm64";
  if (process.platform === "win32") return arm ? "windowsarm64" : "windows64";
  if (process.platform === "darwin") return arm ? "macosarm64" : "macosx64";
  return arm ? "linuxarm64" : "linux64";
}

export function readLock() {
  return JSON.parse(fs.readFileSync(LOCK, "utf8"));
}

async function hashFile(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest("hex");
}

async function download(name, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const res = await fetch(`${BASE}/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`${res.status} downloading ${name}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(`${target}.partial`));
  fs.renameSync(`${target}.partial`, target);
}

async function ensureArchive(entry) {
  const archive = path.join(CACHE, "downloads", entry.file);
  if (!fs.existsSync(archive)) {
    console.error(`downloading ${entry.file}`);
    await download(entry.file, archive);
  }
  const sha1 = await hashFile(archive, "sha1");
  if (sha1 !== entry.sha1) throw new Error(`SHA-1 mismatch for ${entry.file}: ${sha1}`);
  if (entry.sha256) {
    const sha256 = await hashFile(archive, "sha256");
    if (sha256 !== entry.sha256) throw new Error(`SHA-256 mismatch for ${entry.file}: ${sha256}`);
  }
  return archive;
}

async function fetchIndex() {
  const res = await fetch(`${BASE}/index.json`);
  if (!res.ok) throw new Error(`${res.status} reading the CEF index`);
  return res.json();
}

async function pin(version, platforms) {
  const index = await fetchIndex();
  const stable = index[platforms[0]].versions.find((v) => v.channel === "stable");
  const cefVersion = version ?? stable.cef_version;
  const lock = {
    engine: "cef",
    cefVersion,
    chromiumVersion: index[platforms[0]].versions.find((v) => v.cef_version === cefVersion).chromium_version,
    channel: "stable",
    source: BASE,
    packages: {},
  };
  for (const platform of platforms) {
    const build = index[platform].versions.find((v) => v.cef_version === cefVersion);
    if (!build) throw new Error(`${cefVersion} has no ${platform} build`);
    const file = build.files.find((f) => f.type === "standard");
    const entry = { file: file.name, size: file.size, sha1: file.sha1 };
    const archive = await ensureArchive(entry);
    entry.sha256 = await hashFile(archive, "sha256");
    lock.packages[platform] = entry;
    console.error(`pinned ${platform} ${entry.sha256}`);
  }
  fs.mkdirSync(path.dirname(LOCK), { recursive: true });
  fs.writeFileSync(LOCK, `${JSON.stringify(lock, null, 2)}\n`);
}

export async function fetchEngine(platform = currentPlatform()) {
  const lock = readLock();
  const entry = lock.packages[platform];
  if (!entry) throw new Error(`no pinned package for ${platform}`);
  const unpackDir = path.join(CACHE, platform);
  const root = path.join(unpackDir, entry.file.replace(/\.tar\.bz2$/, ""));
  if (!fs.existsSync(path.join(root, "cmake", "FindCEF.cmake"))) {
    const archive = await ensureArchive(entry);
    fs.rmSync(unpackDir, { recursive: true, force: true });
    fs.mkdirSync(unpackDir, { recursive: true });
    console.error(`unpacking ${entry.file}`);
    const tar = process.platform === "win32" ? path.join(process.env.WINDIR, "System32", "tar.exe") : "tar";
    execFileSync(tar, ["-xf", archive, "-C", unpackDir], { stdio: "inherit" });
  }
  return root;
}

async function check() {
  const lock = readLock();
  const index = await fetchIndex();
  const stable = index.windows64.versions.find((v) => v.channel === "stable");
  const current = stable.cef_version === lock.cefVersion;
  console.log(JSON.stringify({ pinned: lock.cefVersion, newestStable: stable.cef_version, newestChromium: stable.chromium_version, current }, null, 2));
  return current;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, arg] = process.argv.slice(2);
  if (command === "pin") await pin(arg, PLATFORMS.filter((p) => ["windows64", "macosarm64", "macosx64", "linux64"].includes(p)));
  else if (command === "fetch") console.log(await fetchEngine(arg));
  else if (command === "check") process.exit((await check()) ? 0 : 1);
  else throw new Error("usage: engine.mjs pin|fetch|check");
}
