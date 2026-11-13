// Writes the files a release needs next to the downloaded packages:
//   orbit-extension-updates.xml  update feed for the built-in extension (Shields rules)
//   latest.json                  what the browser's update notice compares against
//   SHA256SUMS.txt               checksums of every file
// and NOTES.md (release notes) in the current folder.
//   node tools/release-files.mjs <dist folder> <tag> <owner/repo>
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const EXTENSION_ID = "kceipbaiojomdibnboffoieecidpfdck";
const [dist, tag, repo] = process.argv.slice(2);
if (!dist || !/^v\d+\.\d+\.\d+$/.test(tag ?? "") || !/^[\w.-]+\/[\w.-]+$/.test(repo ?? "")) {
  console.error("usage: release-files.mjs <dist folder> <tag vX.Y.Z> <owner/repo>");
  process.exit(2);
}

const files = fs.readdirSync(dist);
const find = (pattern) => {
  const name = files.find((file) => pattern.test(file));
  if (!name) throw new Error(`missing ${pattern} in ${dist}`);
  return name;
};

const windows = find(/^OrbitSetup-[\d.]+-x64\.exe$/);
const mac = find(/^Orbit-[\d.]+-mac-arm64(-unsigned)?\.dmg$/);
const deb = find(/^orbit_[\d.]+_amd64\.deb$/);
const archive = find(/^Orbit-[\d.]+-linux-x64\.tar\.xz$/);
find(/^orbit-extension\.crx$/);
const browserVersion = windows.match(/^OrbitSetup-([\d.]+)-x64\.exe$/)[1];

const extensionInfo = JSON.parse(fs.readFileSync(path.join(dist, "orbit-extension.json"), "utf8"));
const extensionVersion = String(extensionInfo.external_version);
if (!/^\d+(\.\d+){0,3}$/.test(extensionVersion)) throw new Error(`bad extension version ${extensionVersion}`);
fs.rmSync(path.join(dist, "orbit-extension.json"));

const download = (name) => `https://github.com/${repo}/releases/download/${tag}/${name}`;
fs.writeFileSync(
  path.join(dist, "orbit-extension-updates.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<gupdate xmlns="http://www.google.com/update2/response" protocol="2.0">
  <app appid="${EXTENSION_ID}">
    <updatecheck codebase="${download("orbit-extension.crx")}" version="${extensionVersion}" />
  </app>
</gupdate>
`,
);

fs.writeFileSync(
  path.join(dist, "latest.json"),
  `${JSON.stringify({ tag, browserVersion, extensionVersion, url: `https://github.com/${repo}/releases/tag/${tag}` }, null, 2)}\n`,
);

const sums = fs
  .readdirSync(dist)
  .filter((name) => name !== "SHA256SUMS.txt")
  .sort()
  .map((name) => `${crypto.createHash("sha256").update(fs.readFileSync(path.join(dist, name))).digest("hex")}  ${name}`);
fs.writeFileSync(path.join(dist, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);

const unsignedMac = mac.includes("-unsigned");
fs.writeFileSync(
  "NOTES.md",
  `Orbit ${tag}, built on Chromium ${browserVersion}.

| System | Download |
| --- | --- |
| Windows 10 and 11 (x64) | [${windows}](${download(windows)}) |
| macOS 12 or later (Apple silicon) | [${mac}](${download(mac)}) |
| Linux (x64, Debian and Ubuntu) | [${deb}](${download(deb)}) |
| Linux (x64, any distribution) | [${archive}](${download(archive)}) |

**Installing**
- Windows: run the installer. It installs for your user account, no administrator rights needed. The installer is not code-signed yet, so Windows SmartScreen may show "Windows protected your PC": choose More info, then Run anyway.
- macOS: open the disk image and drag Orbit to Applications.${unsignedMac ? " This build is not signed yet: the first time, right-click Orbit in Applications and choose Open." : ""}
- Linux: \`sudo apt install ./${deb}\`, or unpack the archive and run \`orbit/orbit\`.

Check a download against SHA256SUMS.txt, for example \`sha256sum -c SHA256SUMS.txt --ignore-missing\`.

Shields rules update between releases through the built-in extension (version ${extensionVersion}). Known limits are listed in [docs/KNOWN_LIMITS.md](https://github.com/${repo}/blob/${tag}/docs/KNOWN_LIMITS.md).
`,
);
console.log(fs.readdirSync(dist).join("\n"));
