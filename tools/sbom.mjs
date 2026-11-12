// Writes a CycloneDX software bill of materials for what ships in a package.
//   node tools/sbom.mjs <output file>
// Chromium's own third-party components are listed in CREDITS.html, which ships with every package.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));

export function createSbom() {
  const pkg = readJson("package.json");
  const engine = readJson("engine/engine.json");
  const filters = readJson("filters/rules/meta.json");
  const font = path.join(ROOT, "extension", "src", "shared", "fonts", "ReadexPro.ttf");
  const media = path.join(ROOT, "extension", "src", "newtab", "media");
  const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

  const components = [
    {
      type: "framework",
      name: "Chromium Embedded Framework",
      version: engine.cefVersion,
      licenses: [{ license: { id: "BSD-3-Clause" } }],
      externalReferences: [{ type: "distribution", url: engine.source }],
      hashes: Object.values(engine.packages).map((entry) => ({ alg: "SHA-256", content: entry.sha256 })),
    },
    {
      type: "application",
      name: "Chromium",
      version: engine.chromiumVersion,
      licenses: [{ license: { id: "BSD-3-Clause" } }],
      description: "Included in CEF. Its own third-party components are listed in CREDITS.html.",
    },
    {
      type: "library",
      name: "Readex Pro",
      licenses: [{ license: { id: "OFL-1.1" } }],
      hashes: [{ alg: "SHA-256", content: sha256(font) }],
    },
    ...[
      ["blackhole.webm", "Re-encoded video, the new tab page's default background."],
      ["blackhole.jpg", "One frame of the video, shown until it plays and when motion is reduced."],
    ].map(([file, description]) => ({
      type: "data",
      name: `Black Hole Accretion Disk Visualization (${file})`,
      "bom-ref": `background-${file}`,
      description: `${description} Credit: NASA's Goddard Space Flight Center/Jeremy Schnittman.`,
      licenses: [{ license: { name: "Public domain (NASA media guidelines)" } }],
      externalReferences: [{ type: "website", url: "https://svs.gsfc.nasa.gov/13326/" }],
      hashes: [{ alg: "SHA-256", content: sha256(path.join(media, file)) }],
    })),
    ...Object.entries(filters.lists).map(([id, list]) => ({
      type: "data",
      name: list.name,
      "bom-ref": `filter-list-${id}`,
      version: filters.generated,
      licenses: [{ expression: list.license }],
      externalReferences: [{ type: "website", url: list.homepage }],
      hashes: [{ alg: "SHA-256", content: list.sha256 }],
    })),
  ];

  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      component: { type: "application", name: "Orbit", version: pkg.version, licenses: [{ license: { id: "MPL-2.0" } }], supplier: { name: "NovaTech" } },
    },
    components,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) throw new Error("usage: sbom.mjs <output file>");
  fs.writeFileSync(out, `${JSON.stringify(createSbom(), null, 2)}\n`);
  console.log(`wrote ${out}`);
}
