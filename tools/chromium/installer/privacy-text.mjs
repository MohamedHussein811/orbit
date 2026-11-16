// Writes PRIVACY.md as plain text for the Windows setup's privacy policy page, which shows text
// files, not Markdown. Tables become one paragraph per row.
//   node tools/chromium/installer/privacy-text.mjs <output.txt>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const out = process.argv[2];
if (!out) {
  console.error("usage: privacy-text.mjs <output.txt>");
  process.exit(2);
}

const REPO = "https://github.com/MohamedHussein811/orbit/blob/main/";
const inline = (text) =>
  text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => (/^https?:/.test(url) ? `${label} (${url})` : `${label} (${REPO}${url})`))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
const cells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => inline(cell.trim()));

const lines = fs.readFileSync(path.join(ROOT, "PRIVACY.md"), "utf8").split(/\r?\n/);
const text = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (line.startsWith("|")) {
    const head = cells(line);
    i += 1;
    while (lines[i + 1]?.startsWith("|")) {
      i += 1;
      const row = cells(lines[i]);
      text.push(`- ${row[0]}: ${head.slice(1).map((name, n) => `${name}: ${row[n + 1]}`).join(". ")}.`, "");
    }
  } else if (line.startsWith("# ")) {
    text.push(line.slice(2).toUpperCase(), "");
  } else if (line.startsWith("## ")) {
    text.push(line.slice(3), "");
  } else if (line.trim()) {
    const paragraph = [line.trim()];
    while (lines[i + 1]?.trim() && !/^(#|\|)/.test(lines[i + 1])) paragraph.push(lines[++i].trim());
    text.push(inline(paragraph.join(" ")), "");
  }
}
fs.writeFileSync(out, `﻿${text.join("\r\n").trim()}\r\n`);
