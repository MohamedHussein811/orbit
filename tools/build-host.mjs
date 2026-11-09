// Builds the Orbit host against the pinned CEF distribution.
//   node tools/build-host.mjs [--targets orbit,orbit_test] [--jobs N]
// On Windows the build tree defaults to %LOCALAPPDATA%\NovaTech\orbit-build, because Controlled
// Folder Access can block compilers from writing under protected project folders.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brand } from "./brand.mjs";
import { buildExtension } from "./build-extension.mjs";
import { currentPlatform, fetchEngine } from "./engine.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

export function buildDir() {
  if (process.env.ORBIT_BUILD_DIR) return process.env.ORBIT_BUILD_DIR;
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA, "NovaTech", "orbit-build");
  return path.join(ROOT, "out", "host");
}

/** Starts from the engine's original resource packs, so branding never builds on an earlier run. */
function brandResources(cefRoot, out, target) {
  const framework = "Chromium Embedded Framework.framework";
  const mac = process.platform === "darwin";
  const source = mac ? path.join(cefRoot, "Release", framework, "Resources") : path.join(cefRoot, "Resources");
  const app = target === "orbit" ? "Orbit.app" : "OrbitTest.app";
  const destination = mac ? path.join(out, target, app, "Contents", "Frameworks", framework, "Resources") : path.join(out, target);
  for (const name of fs.readdirSync(source)) {
    const isPack = name.endsWith(".pak") || name === "locales" || name.endsWith(".lproj");
    if (isPack) fs.cpSync(path.join(source, name), path.join(destination, name), { recursive: true });
  }
  brand(destination, path.join(cefRoot, "include"));
}

function extensionOutput(out, target) {
  if (process.platform !== "darwin") return path.join(out, target, "orbit-core");
  const app = target === "orbit" ? "Orbit.app" : "OrbitTest.app";
  return path.join(out, target, app, "Contents", "Resources", "orbit-core");
}

function defaultJobs() {
  const byMemory = Math.max(1, Math.floor(os.totalmem() / 1024 ** 3 / 2.5));
  return Math.min(os.availableParallelism(), byMemory);
}

function windowsScript(cefRoot, out, targets, jobs) {
  const vswhere = path.join(process.env["ProgramFiles(x86)"], "Microsoft Visual Studio", "Installer", "vswhere.exe");
  const found = spawnSync(vswhere, ["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"], { encoding: "utf8" });
  const vs = found.stdout?.trim();
  if (!vs) throw new Error("Visual Studio with the C++ tools was not found");
  const cmakeDir = path.join(vs, "Common7", "IDE", "CommonExtensions", "Microsoft", "CMake");
  const script = path.join(out, "build.cmd");
  fs.writeFileSync(
    script,
    [
      "@echo off",
      `call "${path.join(vs, "VC", "Auxiliary", "Build", "vcvars64.bat")}" >nul || exit /b 1`,
      `set "PATH=${path.join(cmakeDir, "CMake", "bin")};${path.join(cmakeDir, "Ninja")};%PATH%"`,
      `cmake -G Ninja -DCMAKE_BUILD_TYPE=Release "-DCEF_ROOT=${cefRoot.replaceAll("\\", "/")}" -S "${path.join(ROOT, "host")}" -B "${out}" || exit /b 1`,
      `ninja -j ${jobs} -C "${out}" ${targets.join(" ")} || exit /b 1`,
      "",
    ].join("\r\n"),
  );
  return ["cmd", ["/c", script]];
}

function posixScript(cefRoot, out, targets, jobs) {
  const arch = currentPlatform().endsWith("arm64") ? "arm64" : "x86_64";
  const projectArch = process.platform === "darwin" ? [`-DPROJECT_ARCH=${arch}`] : [];
  const script = path.join(out, "build.sh");
  fs.writeFileSync(
    script,
    [
      "#!/bin/sh",
      "set -e",
      `cmake -G Ninja -DCMAKE_BUILD_TYPE=Release ${projectArch.join(" ")} "-DCEF_ROOT=${cefRoot}" -S "${path.join(ROOT, "host")}" -B "${out}"`,
      `ninja -j ${jobs} -C "${out}" ${targets.join(" ")}`,
      "",
    ].join("\n"),
  );
  return ["sh", [script]];
}

export async function build({ targets = ["orbit", "orbit_test"], jobs = defaultJobs() } = {}) {
  const cefRoot = await fetchEngine();
  const out = buildDir();
  fs.mkdirSync(out, { recursive: true });
  const [command, args] = process.platform === "win32" ? windowsScript(cefRoot, out, targets, jobs) : posixScript(cefRoot, out, targets, jobs);
  const started = Date.now();
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`build failed with exit code ${result.status}`);
  // These run on every build, because changes to them do not relink the host.
  for (const target of targets) {
    brandResources(cefRoot, out, target);
    buildExtension(extensionOutput(out, target));
  }
  console.log(`built ${targets.join(", ")} in ${Math.round((Date.now() - started) / 1000)} s at ${out}`);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build({ targets: arg("targets", "orbit,orbit_test").split(","), jobs: Number(arg("jobs", defaultJobs())) });
}
