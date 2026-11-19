#!/usr/bin/env node
// Git pre-push hook (tools/githooks/pre-push). Blocks a push when
//  - the changes carry private data (any branch), or
//  - it would start desktop browser builds on design or main with a build configuration that
//    has not built green on every desktop platform (build-gate.mjs).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { check, describe, root } from "./build-gate.mjs";
import { describeFindings, scanRange } from "./private-scan.mjs";

const ZERO = /^0+$/;
const RELEASE_BRANCHES = new Set(["refs/heads/design", "refs/heads/main"]);
const BUILD_PATHS = [
  /^chromium\//,
  /^tools\/chromium\//,
  /^tools\/build-extension\.mjs$/,
  /^extension\//,
  /^\.github\/workflows\/chromium-stage\.yml$/,
  /^\.github\/workflows\/browser-(linux|windows|mac)\.yml$/,
];

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 << 20 }).trim();

function baseFor(localSha, remoteSha) {
  if (!ZERO.test(remoteSha)) {
    try {
      git("cat-file", "-e", `${remoteSha}^{commit}`);
      return remoteSha;
    } catch {}
  }
  for (const ref of ["origin/design", "origin/main"]) {
    try {
      return git("merge-base", localSha, ref);
    } catch {}
  }
  return null;
}

const updates = readFileSync(0, "utf8")
  .split("\n")
  .map((line) => line.trim().split(/\s+/))
  .filter((parts) => parts.length === 4);

let failed = false;
for (const [, localSha, remoteRef, remoteSha] of updates) {
  if (ZERO.test(localSha)) continue;
  const base = baseFor(localSha, remoteSha);
  if (!base) {
    console.error(`pre-push: no common base for ${remoteRef}; cannot scan it.`);
    failed = true;
    continue;
  }

  const findings = scanRange(base, localSha);
  if (findings.length) {
    console.error(`pre-push (${remoteRef}): ${describeFindings(findings)}`);
    failed = true;
  }

  if (!RELEASE_BRANCHES.has(remoteRef)) continue;
  const changed = git("diff", "--name-only", base, localSha).split("\n").filter(Boolean);
  if (!changed.some((file) => BUILD_PATHS.some((p) => p.test(file)))) continue;
  const result = check(localSha);
  if (!result.ok) {
    console.error(`pre-push (${remoteRef}): this push starts desktop browser builds.\n${describe(result)}`);
    failed = true;
  }
}

if (failed) {
  console.error("\nPush blocked by tools/guard (see notes/BUILD.md).");
  process.exit(1);
}
