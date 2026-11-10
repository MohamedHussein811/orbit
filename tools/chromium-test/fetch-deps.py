#!/usr/bin/env python3
"""Fetches prebuilt dependencies that Chromium's Linux-made source archive carries only for Linux.

Usage: fetch-deps.py <src folder> <DEPS entry>...
Entries are read from src/DEPS, or from <folder>/DEPS when written as <folder>:<entry>, for an
Apple silicon Mac host. Package server downloads are
content-addressed, and storage downloads are checked against the sha256 in DEPS.
"""

import collections
import hashlib
import io
import os
import shutil
import sys
import tarfile
import time
import urllib.parse
import urllib.request
import zipfile

HOST = {"host_os": "mac", "host_cpu": "arm64", "checkout_mac": True, "non_git_source": True}


def read_deps(path):
    scope = {"Str": str}
    scope["Var"] = lambda name: str(scope["vars"].get(name, ""))
    with open(path, encoding="utf-8") as source:
        exec(source.read(), scope)
    return scope["deps"]


def applies(condition):
    if not condition:
        return True
    names = collections.defaultdict(bool, HOST)
    return bool(eval(condition, {"__builtins__": {}}, names))


def download(url):
    with urllib.request.urlopen(url, timeout=300) as response:
        return response.read()


def fresh(folder):
    shutil.rmtree(folder, ignore_errors=True)
    os.makedirs(folder)


def fetch_cipd(entry, folder, keep):
    if not keep:
        fresh(folder)
    for package in entry["packages"]:
        name = package["package"].replace("${{platform}}", "mac-arm64").replace("${{arch}}", "arm64")
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


def fetch_gcs(entry, folder, keep):
    objects = [item for item in entry["objects"] if applies(item.get("condition", ""))]
    if not objects:
        raise SystemExit("no storage object applies to this host")
    if not keep:
        fresh(folder)
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
            with open(os.path.join(folder, name), "wb") as output:
                output.write(data)


def main():
    root = sys.argv[1]
    for item in sys.argv[2:]:
        # A leading + adds to an existing folder instead of replacing it.
        keep = item.startswith("+")
        item = item.lstrip("+")
        # An entry from a sub-project's DEPS is written as <folder>:<entry>, relative to that folder.
        base, _, name = item.rpartition(":") if ":" in item and not item.startswith("src/") else ("", "", item)
        deps = read_deps(os.path.join(root, base, "DEPS"))
        entry = deps[name]
        folder = os.path.join(root, base, name.removeprefix("src/"))
        print(f"{name} [{entry['dep_type']}]")
        if not applies(entry.get("condition", "")):
            raise SystemExit(f"{name} does not apply to this host")
        if entry["dep_type"] == "cipd":
            fetch_cipd(entry, folder, keep)
        else:
            fetch_gcs(entry, folder, keep)


if __name__ == "__main__":
    main()
