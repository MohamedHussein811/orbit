#!/usr/bin/env python3
"""Fetches dependencies that Chromium's Linux-made source archive carries only for Linux.

Usage:
  fetch-deps.py <src folder> <DEPS entry>...   fetch the named entries for this host
  fetch-deps.py <src folder> --windows-extras  fetch every entry Windows needs and Linux does not

Entries are read from src/DEPS, or from <folder>/DEPS when written as <folder>:<entry>. A leading
+ adds to an existing folder instead of replacing it. Package server downloads are
content-addressed, storage downloads are checked against the sha256 in DEPS, and source
repositories come from Chromium's own Git server at the pinned commit.
"""

import collections
import hashlib
import io
import os
import re
import shutil
import sys
import tarfile
import time
import urllib.parse
import urllib.request
import zipfile

# What gclient would know about each host when it evaluates conditions.
HOSTS = {
    "mac": {"host_os": "mac", "host_cpu": "arm64", "checkout_mac": True, "checkout_arm64": True},
    "win": {"host_os": "win", "host_cpu": "x64", "checkout_win": True, "checkout_x64": True},
    "linux": {"host_os": "linux", "host_cpu": "x64", "checkout_linux": True, "checkout_x64": True},
}
COMMON = {"non_git_source": True, "build_with_chromium": True, "dawn_standalone": False}
PLATFORMS = {"mac": ("mac-arm64", "arm64"), "win": ("windows-amd64", "amd64"), "linux": ("linux-amd64", "amd64")}

SUB_PROJECTS = ["third_party/angle", "third_party/dawn", "third_party/openscreen/src", "third_party/devtools-frontend/src"]
SKIP = re.compile(
    r"test|apache|goldctl|webkit/data|pgo|telemetry|wpr|siso|reclient|luci-go|resultdb|"
    r"llvm-build|rust-toolchain|cpython3/linux-amd64|updater/chrome_|_386|_x86/|win_arm64|arm64_sans|/x86"
)


def read_deps(path):
    scope = {"Str": str}
    scope["Var"] = lambda name: str(scope["vars"].get(name, ""))
    with open(path, encoding="utf-8") as source:
        exec(source.read(), scope)
    return scope


def applies(condition, host, variables):
    if not condition:
        return True
    names = collections.defaultdict(bool, {**variables, **COMMON, **HOSTS[host]})
    return bool(eval(condition, {"__builtins__": {}}, names))


def download(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=300) as response:
                return response.read()
        except OSError:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))


def fresh(folder):
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder)


def platform_name(text, host):
    platform, arch = PLATFORMS[host]
    return text.replace("${{platform}}", platform).replace("${{arch}}", arch)


def fetch_cipd(entry, folder, keep, host):
    if not keep:
        fresh(folder)
    os.makedirs(folder, exist_ok=True)
    for package in entry["packages"]:
        name = platform_name(package["package"], host)
        version = urllib.parse.quote(package["version"], safe="")
        data = download(f"https://chrome-infra-packages.appspot.com/dl/{name}/+/{version}")
        print(f"  {name} {package['version']} sha256 {hashlib.sha256(data).hexdigest()}")
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for member in archive.infolist():
                target = archive.extract(member, folder)
                mode = member.external_attr >> 16
                if mode:
                    os.chmod(target, mode & 0o777)
                # Keep the packaged dates, so a stage that fetches again does not look newer to ninja.
                stamp = time.mktime(member.date_time + (0, 0, -1))
                os.utime(target, (stamp, stamp))


def fetch_gcs(entry, objects, folder, keep):
    if not keep:
        fresh(folder)
    os.makedirs(folder, exist_ok=True)
    for item in objects:
        data = download(f"https://storage.googleapis.com/{entry['bucket']}/{item['object_name']}")
        actual = hashlib.sha256(data).hexdigest()
        if actual != item["sha256sum"]:
            raise SystemExit(f"hash mismatch for {item['object_name']}: {actual}")
        print(f"  {item['object_name']} sha256 verified")
        name = item.get("output_file") or os.path.basename(item["object_name"])
        if ".tar" in name:
            with tarfile.open(fileobj=io.BytesIO(data)) as archive:
                archive.extractall(folder, filter="tar")
        else:
            path = os.path.join(folder, name)
            with open(path, "wb") as output:
                output.write(data)
            if "generation" in item:
                stamp = item["generation"] / 1e6
                os.utime(path, (stamp, stamp))


def fetch_git(url, folder):
    repository, _, revision = url.rpartition("@")
    repository = repository.removesuffix(".git")
    if not repository.startswith("https://chromium.googlesource.com/"):
        raise SystemExit(f"cannot fetch {repository}: only Chromium's Git server is supported")
    data = download(f"{repository}/+archive/{revision}.tar.gz")
    print(f"  {repository} @ {revision}")
    os.makedirs(folder, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        archive.extractall(folder, filter="tar")


def kind(entry):
    if isinstance(entry, str):
        return "git"
    return entry.get("dep_type", "git")


def fetch_named(root, items, host):
    for item in items:
        keep = item.startswith("+")
        item = item.lstrip("+")
        base, _, name = item.rpartition(":") if ":" in item and not item.startswith("src/") else ("", "", item)
        scope = read_deps(os.path.join(root, base, "DEPS"))
        variables = scope.get("vars", {})
        entry = scope["deps"][name]
        folder = os.path.join(root, base, name.removeprefix("src/"))
        print(f"{name} [{kind(entry)}]")
        if not applies(entry.get("condition", ""), host, variables):
            raise SystemExit(f"{name} does not apply to this host")
        if kind(entry) == "cipd":
            fetch_cipd(entry, folder, keep, host)
        elif kind(entry) == "gcs":
            objects = [o for o in entry["objects"] if applies(o.get("condition", ""), host, variables)]
            if not objects:
                raise SystemExit("no storage object applies to this host")
            fetch_gcs(entry, objects, folder, keep)
        else:
            fetch_git(entry if isinstance(entry, str) else entry["url"], folder)


def fetch_extras(root, host):
    """Fetches what host needs beyond a Linux checkout, which is what the source archive holds."""
    # Files are added, never removed: Chromium keeps its own build files in some of these folders.
    files = [("", "DEPS")] + [(sub, os.path.join(sub, "DEPS")) for sub in SUB_PROJECTS]
    for base, deps_file in files:
        path = os.path.join(root, deps_file)
        if not os.path.exists(path):
            continue
        scope = read_deps(path)
        variables = scope.get("vars", {})
        relative = scope.get("use_relative_paths", False)
        for name, entry in sorted(scope["deps"].items()):
            if entry is None or SKIP.search(name):
                continue
            condition = "" if isinstance(entry, str) else entry.get("condition", "")
            on_host = applies(condition, host, variables)
            on_linux = applies(condition, "linux", variables)
            if not on_host:
                continue
            folder = os.path.join(root, base if relative else "", name.removeprefix("src/"))
            label = os.path.relpath(folder, root)
            if kind(entry) == "gcs":
                objects = [
                    o for o in entry["objects"]
                    if applies(o.get("condition", ""), host, variables)
                    and not (on_linux and applies(o.get("condition", ""), "linux", variables))
                ]
                if objects:
                    print(f"{label} [gcs]")
                    fetch_gcs(entry, objects, folder, keep=True)
            elif kind(entry) == "cipd":
                per_platform = any("${{" in p["package"] for p in entry["packages"])
                if not on_linux or per_platform:
                    print(f"{label} [cipd]")
                    fetch_cipd(entry, folder, keep=True, host=host)
            elif not on_linux:
                print(f"{label} [git]")
                fetch_git(entry if isinstance(entry, str) else entry["url"], folder)


def main():
    root = sys.argv[1]
    host = {"darwin": "mac", "win32": "win"}.get(sys.platform, "linux")
    if sys.argv[2:] == ["--windows-extras"]:
        fetch_extras(root, "win")
    else:
        fetch_named(root, sys.argv[2:], host)


if __name__ == "__main__":
    main()
