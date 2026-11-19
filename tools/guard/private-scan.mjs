#!/usr/bin/env node
// Scans added lines of a diff for private data: local paths, secrets, and the owner-specific
// patterns listed one regular expression per line in .git/orbit-private-patterns (kept out of
// the repository, since the patterns themselves are private).
//
//   node tools/guard/private-scan.mjs --cached
//   node tools/guard/private-scan.mjs <base> <head>
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const GENERIC = [
  /\b[A-Za-z]:[\\/]+(Users|MSA)[\\/]/,
  /[\\/]AppData[\\/]/,
  /scratchpad/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bghp_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bsk-ant-[A-Za-z0-9_-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
];
const TOKEN = /token=/i;
const TOKEN_ALLOWED = /^(filters\/|extension\/src\/sites\/)/;
const SELF = "tools/guard/private-scan.mjs";

function localPatterns() {
  try {
    return readFileSync(path.join(root, ".git", "orbit-private-patterns"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => new RegExp(line, "i"));
  } catch {
    return [];
  }
}

export function scanDiff(diff) {
  const patterns = [...GENERIC, ...localPatterns()];
  const findings = [];
  let file = "";
  let lineNo = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.replace(/^\+\+\+ (b\/)?/, "");
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) {
      lineNo = Number(hunk[1]);
      continue;
    }
    if (line.startsWith("-")) continue;
    if (line.startsWith("+")) {
      const text = line.slice(1);
      if (file !== SELF) {
        const hit = patterns.find((p) => p.test(text)) ?? (TOKEN.test(text) && !TOKEN_ALLOWED.test(file) ? TOKEN : null);
        if (hit) findings.push({ file, line: lineNo, pattern: String(hit), text: text.trim().slice(0, 160) });
      }
      lineNo += 1;
    } else if (!line.startsWith("\\")) {
      lineNo += 1;
    }
  }
  return findings;
}

export function scanRange(base, head) {
  const diff = execFileSync("git", ["diff", "--no-color", "--unified=0", base, head], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 512 << 20,
  });
  return scanDiff(diff);
}

export function describeFindings(findings) {
  return [
    "Private data in the changes being pushed:",
    ...findings.slice(0, 40).map((f) => `  ${f.file}:${f.line} matches ${f.pattern}: ${f.text}`),
    findings.length > 40 ? `  ...and ${findings.length - 40} more` : "",
    "Remove it before pushing (owner names and emails, local paths, scratchpad paths, secrets).",
  ]
    .filter(Boolean)
    .join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const diff =
    args[0] === "--cached"
      ? execFileSync("git", ["diff", "--cached", "--no-color", "--unified=0"], { cwd: root, encoding: "utf8", maxBuffer: 512 << 20 })
      : execFileSync("git", ["diff", "--no-color", "--unified=0", args[0] ?? "HEAD~1", args[1] ?? "HEAD"], {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 512 << 20,
        });
  const findings = scanDiff(diff);
  if (findings.length) {
    console.log(describeFindings(findings));
    process.exit(1);
  }
  console.log("private-data scan: clean");
}
