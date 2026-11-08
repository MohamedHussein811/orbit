// Packages the release build of the host for the current system.
//   node tools/package.mjs
// Windows: per-user installer. macOS: signed .app in a .dmg. Linux: .tar.gz and .deb.
// macOS signing uses ORBIT_MAC_IDENTITY when set, and an ad-hoc signature otherwise.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildDir } from "./build-host.mjs";
import { currentPlatform, fetchEngine } from "./engine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "out", "package");
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

// Build leftovers that are not part of the product.
const LEFTOVER = /\.(lib|exp|pdb|ilk|ninja_log)$/;

function run(command, args, options = {}) {
  console.log(`> ${path.basename(command)} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function copyProduct(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyProduct(source, target);
    else if (!LEFTOVER.test(entry.name)) fs.copyFileSync(source, target);
  }
}

/** Licenses that must travel with every binary package. */
async function copyNotices(to) {
  const engine = await fetchEngine();
  fs.mkdirSync(to, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "LICENSE"), path.join(to, "LICENSE.txt"));
  fs.copyFileSync(path.join(ROOT, "THIRD_PARTY_NOTICES.md"), path.join(to, "THIRD_PARTY_NOTICES.md"));
  fs.copyFileSync(path.join(engine, "LICENSE.txt"), path.join(to, "CEF_LICENSE.txt"));
  fs.copyFileSync(path.join(engine, "CREDITS.html"), path.join(to, "CREDITS.html"));
}

function writeChecksums() {
  const lines = [];
  for (const name of fs.readdirSync(OUT).sort()) {
    const file = path.join(OUT, name);
    if (!fs.statSync(file).isFile() || name === "SHA256SUMS.txt") continue;
    const hash = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
    lines.push(`${hash}  ${name}`);
  }
  fs.appendFileSync(path.join(OUT, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
  console.log(lines.join("\n"));
}

function findInnoSetup() {
  const candidates = [
    process.env.ORBIT_ISCC,
    path.join(process.env.ProgramFiles ?? "", "Inno Setup 7", "ISCC.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 7", "ISCC.exe"),
    path.join(ROOT, ".cache", "tools", "inno", "ISCC.exe"),
  ];
  const found = candidates.find((candidate) => candidate && fs.existsSync(candidate));
  if (!found) throw new Error("Inno Setup 7 was not found. Install it or set ORBIT_ISCC.");
  return found;
}

async function packageWindows() {
  const stage = path.join(OUT, "stage", "windows");
  fs.rmSync(stage, { recursive: true, force: true });
  copyProduct(path.join(buildDir(), "orbit"), stage);
  await copyNotices(stage);
  const iconSource = path.join(ROOT, "branding", "icons", "orbit.ico");
  run(findInnoSetup(), [
    `/DAppVersion=${version}`,
    `/DSourceDir=${stage}`,
    `/DOutDir=${OUT}`,
    `/DIconFile=${iconSource}`,
    path.join(ROOT, "packaging", "windows", "orbit.iss"),
  ]);
}

function signMacApp(app) {
  const identity = process.env.ORBIT_MAC_IDENTITY || "-";
  const entitlements = (name) => path.join(ROOT, "packaging", "macos", `entitlements-${name}.plist`);
  const hardened = identity === "-" ? [] : ["--options", "runtime", "--timestamp"];
  const sign = (target, entitlement) =>
    run("codesign", ["--force", "--sign", identity, ...hardened, ...(entitlement ? ["--entitlements", entitlements(entitlement)] : []), target]);

  const frameworks = path.join(app, "Contents", "Frameworks");
  const cef = path.join(frameworks, "Chromium Embedded Framework.framework");
  const libraries = path.join(cef, "Libraries");
  if (fs.existsSync(libraries)) {
    for (const name of fs.readdirSync(libraries)) if (name.endsWith(".dylib")) sign(path.join(libraries, name));
  }
  sign(cef);
  for (const name of fs.readdirSync(frameworks)) {
    if (!name.endsWith(".app")) continue;
    const kind = /\(GPU\)/.test(name) ? "gpu" : /\(Renderer\)/.test(name) ? "renderer" : /\(Plugin\)/.test(name) ? "plugin" : null;
    sign(path.join(frameworks, name), kind);
  }
  sign(app, "main");
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=2", app]);
}

async function packageMac() {
  const arch = currentPlatform() === "macosarm64" ? "arm64" : "x64";
  const stage = path.join(OUT, "stage", "macos");
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  const app = path.join(stage, "Orbit.app");
  run("cp", ["-R", path.join(buildDir(), "orbit", "Orbit.app"), app]);
  await copyNotices(path.join(app, "Contents", "Resources", "notices"));
  signMacApp(app);
  fs.symlinkSync("/Applications", path.join(stage, "Applications"));
  const dmg = path.join(OUT, `Orbit-${version}-macos-${arch}.dmg`);
  fs.rmSync(dmg, { force: true });
  run("hdiutil", ["create", "-volname", "Orbit", "-srcfolder", stage, "-ov", "-format", "UDZO", dmg]);
}

async function packageLinux() {
  const stage = path.join(OUT, "stage", "linux");
  fs.rmSync(stage, { recursive: true, force: true });

  // Plain archive
  const tree = path.join(stage, "orbit");
  copyProduct(path.join(buildDir(), "orbit"), tree);
  await copyNotices(tree);
  run("tar", ["-czf", path.join(OUT, `orbit-${version}-linux-x64.tar.gz`), "-C", stage, "orbit"]);

  // Debian package
  const deb = path.join(stage, "deb");
  fs.mkdirSync(path.join(deb, "opt"), { recursive: true });
  run("cp", ["-a", tree, path.join(deb, "opt", "orbit")]);
  fs.mkdirSync(path.join(deb, "usr", "bin"), { recursive: true });
  fs.symlinkSync("/opt/orbit/orbit", path.join(deb, "usr", "bin", "orbit"));
  fs.mkdirSync(path.join(deb, "usr", "share", "applications"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "packaging", "linux", "orbit.desktop"), path.join(deb, "usr", "share", "applications", "orbit.desktop"));
  for (const size of [16, 32, 48, 64, 128, 256, 512]) {
    const iconDir = path.join(deb, "usr", "share", "icons", "hicolor", `${size}x${size}`, "apps");
    fs.mkdirSync(iconDir, { recursive: true });
    fs.copyFileSync(path.join(ROOT, "branding", "icons", `orbit-${size}.png`), path.join(iconDir, "orbit.png"));
  }
  const control = path.join(deb, "DEBIAN");
  fs.mkdirSync(control, { recursive: true });
  fs.writeFileSync(
    path.join(control, "control"),
    [
      "Package: orbit-browser",
      `Version: ${version}`,
      "Section: web",
      "Priority: optional",
      "Architecture: amd64",
      "Maintainer: NovaTech <novaegtech@gmail.com>",
      "Homepage: https://github.com/MohamedHussein811/orbit",
      "Provides: www-browser",
      "Depends: libasound2t64 | libasound2, libatk-bridge2.0-0t64 | libatk-bridge2.0-0, libatk1.0-0t64 | libatk1.0-0, libcairo2, libcups2t64 | libcups2, libdbus-1-3, libdrm2, libgbm1, libgtk-3-0t64 | libgtk-3-0, libnss3, libpango-1.0-0, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2",
      "Description: Orbit, a privacy-focused web browser",
      " Orbit is a free desktop browser by NovaTech, built on the Chromium Embedded",
      " Framework. It has no ads, no analytics and no AI features.",
      "",
    ].join("\n"),
  );
  // The setuid sandbox helper needs these exact permissions, which only root can set.
  fs.writeFileSync(path.join(control, "postinst"), "#!/bin/sh\nset -e\nchown root:root /opt/orbit/chrome-sandbox\nchmod 4755 /opt/orbit/chrome-sandbox\n", { mode: 0o755 });
  run("dpkg-deb", ["--root-owner-group", "--build", deb, path.join(OUT, `orbit-browser_${version}_amd64.deb`)]);
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  if (process.platform === "win32") await packageWindows();
  else if (process.platform === "darwin") await packageMac();
  else await packageLinux();
  fs.rmSync(path.join(OUT, "stage"), { recursive: true, force: true });
  writeChecksums();
}

await main();
