#!/usr/bin/env node
// Build gate: a commit may build the desktop browser on design or main only when its build
// configuration already produced a green build on that platform, compiled entirely with that
// configuration (from scratch, or resumed only from runs with the same configuration).
//
// The configuration is every tools/chromium/args* file, tools/chromium/compile.sh, the stage
// workflow and the platform's runner label.
//
//   node tools/guard/build-gate.mjs check [rev] [linux|windows|mac ...]
//   node tools/guard/build-gate.mjs fingerprint [rev]
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const WORKFLOWS = { linux: "browser-linux.yml", windows: "browser-windows.yml", mac: "browser-mac.yml" };
const STAGE_WORKFLOW = ".github/workflows/chromium-stage.yml";
const CACHE = path.join(root, ".git", "orbit-build-proofs.json");
const MAX_CHAIN = 25;

const git = (...args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 << 20, stdio: ["ignore", "pipe", "pipe"] });

function show(sha, file) {
  try {
    return git("show", `${sha}:${file}`);
  } catch {
    return null;
  }
}

function hasCommit(sha) {
  try {
    git("cat-file", "-e", `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

function ensureCommit(sha) {
  if (hasCommit(sha)) return true;
  try {
    git("fetch", "-q", "origin", sha);
  } catch {
    return false;
  }
  return hasCommit(sha);
}

function repoSlug() {
  const url = git("remote", "get-url", "origin").trim();
  const match = url.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!match) throw new Error(`origin is not a GitHub remote: ${url}`);
  return match[1];
}

function gh(...args) {
  return execFileSync("gh", args, { cwd: root, encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
}

function configFiles(sha) {
  const names = git("ls-tree", "--name-only", `${sha}:tools/chromium`)
    .split("\n")
    .filter((name) => /^(args[\w.-]*|compile\.sh)$/.test(name));
  return [...names.map((name) => `tools/chromium/${name}`), STAGE_WORKFLOW].sort();
}

function workflowText(sha, platform) {
  return show(sha, `.github/workflows/${WORKFLOWS[platform]}`) ?? "";
}

function runnerLabels(sha, platform) {
  const labels = [...workflowText(sha, platform).matchAll(/runner:\s*([\w.-]+)/g)].map((m) => m[1]);
  return [...new Set(labels)].sort();
}

export function fingerprint(sha, platform) {
  const hash = createHash("sha256");
  for (const file of configFiles(sha)) hash.update(`${file}\0${show(sha, file) ?? ""}\0`);
  hash.update(`runner\0${runnerLabels(sha, platform).join(",")}`);
  return hash.digest("hex").slice(0, 16);
}

export function resumedFrom(sha, platform) {
  const stage1 = workflowText(sha, platform)
    .split("\n")
    .find((line) => /stage:\s*1\s*,/.test(line));
  return stage1?.match(/resume_run:\s*"?(\d+)/)?.[1] ?? null;
}

function loadCache() {
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"));
  } catch {
    return { runs: {} };
  }
}

function saveCache(cache) {
  try {
    writeFileSync(CACHE, JSON.stringify(cache, null, 1));
  } catch {}
}

// Facts about one run that never change once it has finished: its commit, platform, the
// configuration it compiled with and the run it continued from.
function runFacts(cache, runId, platform) {
  const cached = cache.runs[runId];
  if (cached && cached.platform === platform && cached.final) return cached;
  let info;
  try {
    info = JSON.parse(gh("api", `repos/${repoSlug()}/actions/runs/${runId}`, "-q", "{sha: .head_sha, status: .status, conclusion: .conclusion, path: .path}"));
  } catch {
    return null;
  }
  if (!info.path?.endsWith(WORKFLOWS[platform])) return null;
  if (!ensureCommit(info.sha)) return null;
  const facts = {
    platform,
    sha: info.sha,
    conclusion: info.conclusion,
    final: info.status === "completed",
    fingerprint: fingerprint(info.sha, platform),
    resumedFrom: resumedFrom(info.sha, platform),
  };
  cache.runs[runId] = facts;
  return facts;
}

function greenRunIds(platform) {
  const out = gh(
    "api",
    `repos/${repoSlug()}/actions/workflows/${WORKFLOWS[platform]}/runs?status=success&per_page=100`,
    "-q",
    ".workflow_runs[].id",
  );
  return out.split("\n").filter(Boolean);
}

// Every object in the run's output was compiled with `wanted`: the run and each run it resumed
// from has that configuration, back to a run that started from scratch.
function compiledWith(cache, runId, platform, wanted) {
  const chain = [];
  let current = runId;
  for (let depth = 0; depth < MAX_CHAIN && current; depth += 1) {
    const facts = runFacts(cache, current, platform);
    if (!facts || facts.fingerprint !== wanted) return null;
    chain.push(current);
    if (!facts.resumedFrom) return chain;
    current = facts.resumedFrom;
  }
  return null;
}

export function proofFor(sha, platform, cache = loadCache()) {
  const wanted = fingerprint(sha, platform);
  let ids;
  try {
    ids = greenRunIds(platform);
  } catch (error) {
    return { platform, wanted, proven: false, error: `could not list runs: ${error.message.split("\n")[0]}` };
  }
  for (const id of ids) {
    const facts = runFacts(cache, id, platform);
    if (!facts || facts.fingerprint !== wanted) continue;
    const chain = compiledWith(cache, id, platform, wanted);
    if (chain) return { platform, wanted, proven: true, run: id, chain, sha: facts.sha };
  }
  return { platform, wanted, proven: false };
}

export function check(rev = "HEAD", platforms = Object.keys(WORKFLOWS)) {
  const sha = git("rev-parse", `${rev}^{commit}`).trim();
  const cache = loadCache();
  const results = platforms.map((platform) => proofFor(sha, platform, cache));
  saveCache(cache);
  return { sha, results, ok: results.every((r) => r.proven) };
}

export function describe({ sha, results }) {
  const lines = [`Build configuration of ${sha.slice(0, 10)}:`];
  for (const r of results) {
    if (r.proven) {
      const how = r.chain.length === 1 ? "from scratch" : `resumed through ${r.chain.slice(1).join(" <- ")}`;
      lines.push(`  ${r.platform}: proven by green run ${r.run} (${how}), config ${r.wanted}`);
    } else {
      lines.push(`  ${r.platform}: NOT PROVEN, config ${r.wanted}${r.error ? ` (${r.error})` : ""}`);
    }
  }
  if (results.some((r) => !r.proven)) {
    lines.push(
      "",
      "No green build on the platforms marked NOT PROVEN was compiled entirely with this",
      "configuration, so it must not build on design or main. Keep releases on the proven",
      "configuration. Test the new one on an exp/* branch from scratch",
      "(gh workflow run browser-<platform>.yml --ref exp/<name>); once green it is proven.",
      "Rules and runner limits: notes/BUILD.md.",
    );
  }
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command = "check", ...rest] = process.argv.slice(2);
  const platforms = rest.filter((arg) => arg in WORKFLOWS);
  const rev = rest.find((arg) => !(arg in WORKFLOWS)) ?? "HEAD";
  if (command === "fingerprint") {
    const sha = git("rev-parse", `${rev}^{commit}`).trim();
    for (const platform of Object.keys(WORKFLOWS)) console.log(`${platform} ${fingerprint(sha, platform)}`);
  } else if (command === "check") {
    const result = check(rev, platforms.length ? platforms : undefined);
    console.log(describe(result));
    process.exit(result.ok ? 0 : 1);
  } else {
    console.error("usage: build-gate.mjs check|fingerprint [rev] [linux|windows|mac ...]");
    process.exit(2);
  }
}
