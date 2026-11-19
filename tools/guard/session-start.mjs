#!/usr/bin/env node
// Claude Code SessionStart hook: keeps the git pre-push guard switched on and reminds the
// session where the build rules live. Its output becomes session context.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

let hooksPath = "";
try {
  hooksPath = git("config", "--get", "core.hooksPath");
} catch {}
if (hooksPath !== "tools/githooks") {
  try {
    git("config", "core.hooksPath", "tools/githooks");
    hooksPath = "tools/githooks (switched on now)";
  } catch {
    hooksPath = "NOT SET: run `git config core.hooksPath tools/githooks`";
  }
}

console.log(
  [
    `Orbit guard: git pre-push hook ${hooksPath}.`,
    "Before any CI build or build-setting change read notes/BUILD.md (runner limits, proven configurations, failure catalog).",
    "Pushes to design/main that start desktop builds, and browser dispatches on design/main, are blocked unless",
    "`node tools/guard/build-gate.mjs check` proves the build configuration on every desktop platform.",
  ].join("\n"),
);
