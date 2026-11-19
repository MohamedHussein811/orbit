#!/usr/bin/env node
// Claude Code PreToolUse hook for Bash and PowerShell commands. Exit code 2 blocks the command
// and shows the message to Claude. Blocks:
//  - skipping git hooks (--no-verify, changing core.hooksPath), which would bypass pre-push;
//  - starting or rerunning a desktop browser build on design or main whose build configuration
//    is not proven (build-gate.mjs);
//  - raw workflow dispatches through gh api, which the gate cannot read.
import { readFileSync } from "node:fs";

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0);
}
const command = String(input?.tool_input?.command ?? "");
if (!/--no-verify|hooksPath|workflow\s+run|run\s+rerun|dispatches/.test(command)) process.exit(0);

function block(message) {
  console.error(`${message}\n(tools/guard/claude-hook.mjs; rules in notes/BUILD.md)`);
  process.exit(2);
}

if (/\bgit\b[^\n;|&]*\s--no-verify\b/.test(command)) {
  block("Blocked: --no-verify skips the pre-push guard (private-data scan and build gate). Fix what it reports instead.");
}
const hooksConfig = command.match(/\bgit\s+config\b[^\n;|&]*core\.hooksPath[^\n;|&]*/)?.[0];
if (
  /\bgit\s+-c\s+core\.hooksPath/.test(command) ||
  (hooksConfig && !/--get\b/.test(hooksConfig) && !/core\.hooksPath\s+tools\/githooks\b/.test(hooksConfig))
) {
  block("Blocked: core.hooksPath must stay tools/githooks so the pre-push guard runs.");
}
if (/\bgh\s+api\b[^\n]*dispatches/.test(command)) {
  block("Blocked: start workflows with `gh workflow run <file> --ref <branch>` so the build gate can check them.");
}

const PLATFORMS = { linux: /linux/i, windows: /windows/i, mac: /\bmac/i };
const RELEASE_REFS = new Set(["design", "main"]);

function platformOf(text) {
  if (!/browser/i.test(text) || /android|iphone|ios/i.test(text)) return null;
  return Object.keys(PLATFORMS).find((p) => PLATFORMS[p].test(text)) ?? null;
}

const { check, describe, root } = await import("./build-gate.mjs");
const { execFileSync } = await import("node:child_process");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

for (const segment of command.split(/&&|\|\||;|\n/)) {
  const dispatch = segment.match(/\bgh\s+workflow\s+run\s+("[^"]+"|'[^']+'|\S+)(.*)/);
  if (dispatch) {
    const platform = platformOf(dispatch[1]);
    if (!platform) continue;
    const ref = dispatch[2].match(/(?:--ref[=\s]+|-r\s+)("[^"]+"|'[^']+'|\S+)/)?.[1]?.replace(/^["']|["']$/g, "") ?? "main";
    if (!RELEASE_REFS.has(ref)) continue;
    try {
      run("git", ["fetch", "-q", "origin", ref]);
    } catch {
      block(`Blocked: could not fetch origin/${ref} to check its build configuration.`);
    }
    const result = check(`origin/${ref}`, [platform]);
    if (!result.ok) block(`Blocked: ${platform} build on ${ref}.\n${describe(result)}`);
    continue;
  }

  const rerun = segment.match(/\bgh\s+run\s+rerun\s+(\d+)/);
  if (rerun) {
    let info;
    try {
      const slug = run("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
      info = JSON.parse(run("gh", ["api", `repos/${slug}/actions/runs/${rerun[1]}`, "-q", "{path: .path, branch: .head_branch, sha: .head_sha}"]));
    } catch {
      block(`Blocked: could not read run ${rerun[1]} to check its build configuration.`);
    }
    const platform = platformOf(info.path ?? "");
    if (!platform || !RELEASE_REFS.has(info.branch)) continue;
    const result = check(info.sha, [platform]);
    if (!result.ok) block(`Blocked: rerun of a ${platform} build on ${info.branch}.\n${describe(result)}`);
  }
}
process.exit(0);
