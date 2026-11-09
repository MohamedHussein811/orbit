// Installs the built package on a disposable CI machine, runs it, and removes it.
// It writes to the system (registry, /opt), so it refuses to run outside CI.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.CI) throw new Error("This test installs system-wide. It only runs on CI.");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "out", "package");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (pattern) => {
  const name = fs.readdirSync(OUT).find((file) => pattern.test(file));
  assert.ok(name, `no package matches ${pattern}`);
  return path.join(OUT, name);
};
const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
const read = (command, args) => execFileSync(command, args, { encoding: "utf8" });

/** Starts the installed browser on a throwaway profile and checks it stays up and writes there. */
async function launchInstalled(binary) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-package-"));
  const child = spawn(binary, [], { detached: true, stdio: "ignore", env: { ...process.env, ORBIT_USER_DATA_DIR: profile } });
  let exit = null;
  child.on("exit", (code, signal) => { exit = { code, signal }; });
  await sleep(15000);
  assert.equal(exit, null, `the installed browser exited: ${JSON.stringify(exit)}`);
  assert.ok(fs.existsSync(path.join(profile, "Local State")), "the installed browser did not start its profile");
  const extensionLoaded = () =>
    ["Secure Preferences", "Preferences"]
      .map((name) => path.join(profile, "Default", name))
      .filter((file) => fs.existsSync(file))
      .some((file) => fs.readFileSync(file, "utf8").includes("boccmnigbogdpajphlpgodcalflpinmk"));
  // Preferences reach the disk some seconds after they change, and later on a slow machine.
  for (let i = 0; i < 60 && !extensionLoaded(); i++) await sleep(1000);
  assert.ok(extensionLoaded(), "the built-in extension did not load");
  assert.ok(fs.existsSync(path.join(profile, "orbit-core", "_metadata")), "the extension is not running from the user's data folder");
  process.kill(child.pid, "SIGKILL");
  await sleep(1000);
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  console.log(`ran ${binary}`);
}

async function windows() {
  const installer = find(/-windows-x64-setup\.exe$/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-install-"));
  run(installer, ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CURRENTUSER", `/DIR=${dir}`]);
  for (const file of ["orbit.exe", "libcef.dll", "chrome_elf.dll", "orbit-core/manifest.json", "CREDITS.html", "LICENSE.txt", "CEF_LICENSE.txt"]) {
    assert.ok(fs.existsSync(path.join(dir, file)), `${file} was not installed`);
  }
  const acl = read("icacls", [dir]);
  assert.match(acl, /S-1-15-2-2|ALL RESTRICTED APPLICATION PACKAGES/, "the network sandbox cannot read the install folder");
  const registered = read("reg", ["query", "HKCU\\Software\\RegisteredApplications", "/v", "Orbit"]);
  assert.match(registered, /Orbit/);
  await launchInstalled(path.join(dir, "orbit.exe"));
  run(path.join(dir, "unins000.exe"), ["/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"]);
  await sleep(4000);
  assert.ok(!fs.existsSync(path.join(dir, "orbit.exe")), "uninstall left the program behind");
  let stillRegistered = true;
  try {
    read("reg", ["query", "HKCU\\Software\\RegisteredApplications", "/v", "Orbit"]);
  } catch {
    stillRegistered = false;
  }
  assert.equal(stillRegistered, false, "uninstall left the browser registration behind");
}

async function macos() {
  const dmg = find(/-macos-(arm64|x64)\.dmg$/);
  const mount = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-dmg-"));
  run("hdiutil", ["attach", dmg, "-nobrowse", "-mountpoint", mount]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "orbit-install-"));
  try {
    run("cp", ["-R", path.join(mount, "Orbit.app"), dir]);
  } finally {
    run("hdiutil", ["detach", mount]);
  }
  const app = path.join(dir, "Orbit.app");
  run("codesign", ["--verify", "--deep", "--strict", app]);
  assert.ok(fs.existsSync(path.join(app, "Contents", "Resources", "orbit.icns")), "the icon is missing");
  assert.ok(fs.existsSync(path.join(app, "Contents", "Resources", "notices", "CREDITS.html")), "license notices are missing");
  await launchInstalled(path.join(app, "Contents", "MacOS", "Orbit"));
  run("codesign", ["--verify", "--deep", "--strict", app]);
  fs.rmSync(dir, { recursive: true, force: true });
}

async function linux() {
  const archive = find(/-linux-x64\.tar\.gz$/);
  const listing = read("tar", ["-tzf", archive]);
  for (const file of ["orbit/orbit", "orbit/chrome-sandbox", "orbit/orbit-core/manifest.json", "orbit/CREDITS.html"]) {
    assert.ok(listing.includes(file), `${file} is not in the archive`);
  }
  const deb = find(/\.deb$/);
  run("sudo", ["apt-get", "install", "-y", deb]);
  const mode = read("stat", ["-c", "%a %U", "/opt/orbit/chrome-sandbox"]).trim();
  assert.equal(mode, "4755 root", "the sandbox helper has the wrong permissions");
  assert.equal(read("readlink", ["/usr/bin/orbit"]).trim(), "/opt/orbit/orbit");
  assert.ok(fs.existsSync("/usr/share/applications/orbit.desktop"));
  await launchInstalled("/opt/orbit/orbit");
  run("sudo", ["apt-get", "remove", "-y", "orbit-browser"]);
  assert.ok(!fs.existsSync("/opt/orbit/orbit"), "removal left the program behind");
}

if (process.platform === "win32") await windows();
else if (process.platform === "darwin") await macos();
else await linux();
console.log("package smoke test passed");
process.exit(0);
