// Packs Orbit's built extension as a signed CRX3 file that the browser installs from its own folder.
//   ORBIT_EXTENSION_KEY=<PKCS#8 PEM> node tools/chromium/pack-extension.mjs <extension folder> <output folder> <build number>
// The output is the same bytes for the same input, so rebuilds only redo work after a real change.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ZIP_DATE = (((2024 - 1980) << 9) | (1 << 5) | 1) & 0xffff;

function listFiles(dir) {
  const files = [];
  const walk = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const file = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(file);
      else files.push(file);
    }
  };
  walk(dir);
  return files;
}

function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, "utf8");
    const compressed = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt16LE(0, 10);
    header.writeUInt16LE(ZIP_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, compressed);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt16LE(0, 12);
    record.writeUInt16LE(ZIP_DATE, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += header.length + nameBytes.length + compressed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

function varint(value) {
  const bytes = [];
  while (value > 0x7f) {
    bytes.push((value & 0x7f) | 0x80);
    value >>>= 7;
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

function field(number, bytes) {
  return Buffer.concat([varint((number << 3) | 2), varint(bytes.length), bytes]);
}

function extensionId(spki) {
  const digest = crypto.createHash("sha256").update(spki).digest().subarray(0, 16);
  return [...digest].map((b) => "abcdefghijklmnop"[b >> 4] + "abcdefghijklmnop"[b & 15]).join("");
}

function crx3(archive, privateKey) {
  const spki = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const crxId = crypto.createHash("sha256").update(spki).digest().subarray(0, 16);
  const signedData = field(1, crxId);
  const length = Buffer.alloc(4);
  length.writeUInt32LE(signedData.length);
  const signature = crypto.sign(
    "sha256",
    Buffer.concat([Buffer.from("CRX3 SignedData\x00", "latin1"), length, signedData, archive]),
    privateKey,
  );
  const header = Buffer.concat([field(2, Buffer.concat([field(1, spki), field(2, signature)])), field(10000, signedData)]);
  const prefix = Buffer.alloc(12);
  prefix.write("Cr24", 0, "latin1");
  prefix.writeUInt32LE(3, 4);
  prefix.writeUInt32LE(header.length, 8);
  return { crx: Buffer.concat([prefix, header, archive]), id: extensionId(spki), spki };
}

const [source, output, build] = process.argv.slice(2);
if (!source || !output || !/^\d+$/.test(build ?? "")) {
  console.error("usage: pack-extension.mjs <extension folder> <output folder> <build number>");
  process.exit(2);
}
if (!process.env.ORBIT_EXTENSION_KEY) {
  console.error("ORBIT_EXTENSION_KEY is not set. It holds the private key that fixes the extension's ID.");
  process.exit(1);
}
const privateKey = crypto.createPrivateKey(process.env.ORBIT_EXTENSION_KEY);
const spki = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });

const manifestPath = path.join(source, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.version = `${manifest.version.split(".").slice(0, 3).join(".")}.${build}`;
manifest.key = spki.toString("base64");
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const entries = listFiles(source)
  .filter((file) => path.basename(file) !== "build-id.txt")
  .map((file) => ({ name: path.relative(source, file).replaceAll("\\", "/"), data: fs.readFileSync(file) }));
const { crx, id } = crx3(zip(entries), privateKey);

fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, "orbit.crx"), crx);
fs.writeFileSync(
  path.join(output, `${id}.json`),
  `${JSON.stringify({ external_crx: "orbit.crx", external_version: manifest.version }, null, 2)}\n`,
);
console.log(`packed extension ${id} version ${manifest.version}: ${entries.length} files, ${crx.length} bytes`);
