// Reader and writer for Chromium's .pak resource format, versions 4 and 5.
import fs from "node:fs";

export const ENCODING_BINARY = 0;
export const ENCODING_UTF8 = 1;
export const ENCODING_UTF16 = 2;

/** Returns { version, encoding, resources: Map<id, Buffer>, aliases: Map<id, targetId> }. */
export function readPak(file) {
  const data = fs.readFileSync(file);
  const version = data.readUInt32LE(0);
  let encoding;
  let resourceCount;
  let aliasCount = 0;
  let cursor;
  if (version === 5) {
    encoding = data.readUInt8(4);
    resourceCount = data.readUInt16LE(8);
    aliasCount = data.readUInt16LE(10);
    cursor = 12;
  } else if (version === 4) {
    resourceCount = data.readUInt32LE(4);
    encoding = data.readUInt8(8);
    cursor = 9;
  } else {
    throw new Error(`${file}: unsupported pak version ${version}`);
  }
  const entries = [];
  for (let i = 0; i <= resourceCount; i++, cursor += 6) {
    entries.push({ id: data.readUInt16LE(cursor), offset: data.readUInt32LE(cursor + 2) });
  }
  const resources = new Map();
  for (let i = 0; i < resourceCount; i++) {
    resources.set(entries[i].id, data.subarray(entries[i].offset, entries[i + 1].offset));
  }
  const aliases = new Map();
  for (let i = 0; i < aliasCount; i++, cursor += 4) {
    aliases.set(data.readUInt16LE(cursor), entries[data.readUInt16LE(cursor + 2)].id);
  }
  return { version, encoding, resources, aliases };
}

/** Always writes version 5, which every supported Chromium reads. */
export function writePak(file, { encoding, resources, aliases }) {
  const ids = [...resources.keys()].sort((a, b) => a - b);
  const aliasIds = [...aliases.keys()].sort((a, b) => a - b);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(5, 0);
  header.writeUInt8(encoding, 4);
  header.writeUInt16LE(ids.length, 8);
  header.writeUInt16LE(aliasIds.length, 10);

  const table = Buffer.alloc((ids.length + 1) * 6);
  const aliasTable = Buffer.alloc(aliasIds.length * 4);
  const indexOf = new Map(ids.map((id, i) => [id, i]));
  let offset = header.length + table.length + aliasTable.length;
  ids.forEach((id, i) => {
    table.writeUInt16LE(id, i * 6);
    table.writeUInt32LE(offset, i * 6 + 2);
    offset += resources.get(id).length;
  });
  table.writeUInt16LE(0, ids.length * 6);
  table.writeUInt32LE(offset, ids.length * 6 + 2);
  aliasIds.forEach((id, i) => {
    aliasTable.writeUInt16LE(id, i * 4);
    aliasTable.writeUInt16LE(indexOf.get(aliases.get(id)), i * 4 + 2);
  });
  fs.writeFileSync(file, Buffer.concat([header, table, aliasTable, ...ids.map((id) => resources.get(id))]));
}
