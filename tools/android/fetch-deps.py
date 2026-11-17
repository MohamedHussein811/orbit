#!/usr/bin/env python3
"""Fetches what an Android build needs beyond the Linux source archive.

Usage: fetch-deps.py <src folder>

Uses the fetchers in tools/chromium/fetch-deps.py with an "android" host: a Linux x64 machine
with checkout_android set, as gclient would see it with target_os = ["android"]. Only entries
that apply to that host and not to plain Linux are fetched, plus Chromium's JDK and the
folders the lite source archive prunes.
"""

import importlib.util
import io
import os
import re
import shutil
import sys
import tarfile

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("fetch_deps", os.path.join(here, "..", "chromium", "fetch-deps.py"))
fd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fd)

fd.HOSTS["android"] = {**fd.HOSTS["linux"], "checkout_android": True}
fd.PLATFORMS["android"] = fd.PLATFORMS["linux"]
linux_name = fd.platform_name
fd.platform_name = lambda text, host: linux_name(text.replace("${{os}}", "linux"), host)

SKIP = re.compile(fd.SKIP.pattern + r"|cts_archive|orderfiles")
PRUNED = ["android_webview", "chrome/android", "chrome/browser/ui/android", "third_party/android_platform"]


def fetch_cipd(entry, folder):
    # Packages that share a folder each carry a read-only .cipdpkg/manifest.json.
    for package in entry["packages"]:
        shutil.rmtree(os.path.join(folder, ".cipdpkg"), ignore_errors=True)
        fd.fetch_cipd({**entry, "packages": [package]}, folder, keep=True, host="android")


def android_only(root):
    files = [("", "DEPS")] + [(sub, os.path.join(sub, "DEPS")) for sub in fd.SUB_PROJECTS]
    for base, deps_file in files:
        path = os.path.join(root, deps_file)
        if not os.path.exists(path):
            continue
        scope = fd.read_deps(path)
        variables = scope.get("vars", {})
        relative = scope.get("use_relative_paths", False)
        for name, entry in sorted(scope["deps"].items()):
            if entry is None or SKIP.search(name):
                continue
            condition = "" if isinstance(entry, str) else entry.get("condition", "")
            if not fd.applies(condition, "android", variables) or fd.applies(condition, "linux", variables):
                continue
            folder = os.path.join(root, base if relative else "", name.removeprefix("src/"))
            print(f"{os.path.relpath(folder, root)} [{fd.kind(entry)}]")
            if fd.kind(entry) == "cipd":
                fetch_cipd(entry, folder)
            elif fd.kind(entry) == "gcs":
                objects = [o for o in entry["objects"] if fd.applies(o.get("condition", ""), "android", variables)]
                fd.fetch_gcs(entry, objects, folder, keep=True)
            else:
                fd.fetch_git(entry if isinstance(entry, str) else entry["url"], folder)


def restore_pruned(root):
    # The lite archive keeps only build files in these folders; the Android build needs the rest.
    with open(os.path.join(root, "chrome", "VERSION"), encoding="utf-8") as source:
        parts = dict(line.strip().split("=", 1) for line in source if "=" in line)
    version = ".".join(parts[key] for key in ("MAJOR", "MINOR", "BUILD", "PATCH"))
    for folder in PRUNED:
        url = f"https://chromium.googlesource.com/chromium/src/+archive/refs/tags/{version}/{folder}.tar.gz"
        data = fd.download(url)
        print(f"{folder} @ {version}")
        with tarfile.open(fileobj=io.BytesIO(data)) as archive:
            archive.extractall(os.path.join(root, folder), filter="tar")


def main():
    root = sys.argv[1]
    restore_pruned(root)
    # The archive has no JDK; desktop Linux links the system java, Android needs Chromium's JDK.
    fd.fetch_named(root, ["src/third_party/jdk/current"], "android")
    android_only(root)


if __name__ == "__main__":
    main()
