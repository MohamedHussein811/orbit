// Builds Orbit's built-in extension into a folder. TypeScript types are stripped with Node's own
// tool, so the build has no third-party dependencies. The type check runs separately in CI.
//   node tools/build-extension.mjs <output folder>
import crypto from "node:crypto";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RULES_DIR } from "./filters.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "extension", "src");
const ICON_SIZES = [16, 32, 48, 128];

function copySources(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    if (entry.isDirectory()) {
      copySources(source, path.join(to, entry.name));
    } else if (entry.name.endsWith(".d.ts")) {
      continue;
    } else if (entry.name.endsWith(".ts")) {
      const stripped = stripTypeScriptTypes(fs.readFileSync(source, "utf8"), { mode: "strip" });
      const code = stripped.replace(/(from\s+"[^"]+)\.ts"/g, '$1.js"').replace(/(import\s*\(\s*"[^"]+)\.ts"/g, '$1.js"');
      fs.writeFileSync(path.join(to, entry.name.replace(/\.ts$/, ".js")), code);
    } else {
      fs.copyFileSync(source, path.join(to, entry.name));
    }
  }
}

/** Hash of every file's path and contents, so any change to the extension gives a new ID. */
function contentId(dir) {
  const hash = crypto.createHash("sha256");
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        walk(file);
      } else {
        hash.update(path.relative(dir, file).replaceAll("\\", "/"));
        hash.update(fs.readFileSync(file));
      }
    }
  };
  walk(dir);
  return hash.digest("hex");
}

export function buildExtension(out) {
  fs.rmSync(out, { recursive: true, force: true });
  copySources(SRC, out);

  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8"));
  manifest.version = version;
  fs.writeFileSync(path.join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const iconDir = path.join(out, "icons");
  fs.mkdirSync(iconDir, { recursive: true });
  for (const size of ICON_SIZES) {
    fs.copyFileSync(path.join(ROOT, "branding", "icons", `orbit-${size}.png`), path.join(iconDir, `orbit-${size}.png`));
  }

  const ruleDir = path.join(out, "rules");
  fs.mkdirSync(ruleDir, { recursive: true });
  fs.cpSync(RULES_DIR, ruleDir, { recursive: true });

  // The host compares this to know when its copy in the user's data folder is out of date.
  fs.writeFileSync(path.join(out, "build-id.txt"), contentId(out));

  console.log(`built extension ${version} at ${out}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildExtension(process.argv[2]);
}
