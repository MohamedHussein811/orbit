#!/usr/bin/env python3
"""Turns an unpacked Chromium source tree into Orbit's.

usage: apply-fork.py <chromium src folder>

The changed files and their hashes go to orbit-fork-files.json in the source folder, which
date-fork.py compares with the saved build.
"""

import hashlib
import json
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

FORK = pathlib.Path(__file__).resolve().parents[2] / "chromium"
NAME = re.compile(r"Chromium(?!OS| OS| Authors)")
STRING_FILES = [
    "chrome/app/chromium_strings.grd",
    "components/components_chromium_strings.grd",
]
XTB = re.compile(r'<file path="([^"]+\.xtb)"')
TRANSLATION_ID = re.compile(r'<translation id="(\d+)"')
TRANSLATION = re.compile(r'(<translation id=")(\d+)("[^>]*>)(.*?)(</translation>)', re.DOTALL)
PART = re.compile(r'<part file="([^"]+\.grdp)"')
# "Chrome" used as the browser's own name in shared strings. Other products and technologies keep
# their names: Google Chrome (as an import source), Chrome Web Store, ChromeOS, Chrome Apps.
CHROME = re.compile(
    r"(?<!Google )(?<!Google&nbsp;)\bChrome\b"
    r"(?!(?: |&nbsp;)?(?:OS|Web Store|Enterprise|Apps?|apps?|Remote Desktop|Root Store|Cleanup)\b)"
)
CHROME_STRING_FILES = ["chrome/app/generated_resources.grd"]


def copy_overlay(src):
    base = FORK / "overlay"
    changed = []
    for path in sorted(base.rglob("*")):
        if path.is_file():
            target = src / path.relative_to(base)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
            changed.append(target)
    return changed


def apply_patches(src):
    changed = []
    for name in (FORK / "patches" / "series").read_text().split():
        patch = FORK / "patches" / name
        print(f"applying {name}")
        subprocess.run(
            ["patch", "-p1", "--forward", "--batch", "--no-backup-if-mismatch", "-i", str(patch)],
            cwd=src,
            check=True,
        )
        for line in patch.read_text().splitlines():
            if line.startswith("+++ b/"):
                changed.append(src / line[len("+++ b/"):].split("\t")[0])
    return changed


def message_ids(grd):
    from grit import grd_reader
    from grit.node import message

    conditions = " ".join(re.findall(r'<if expr="([^"]*)"', grd.read_text(encoding="utf-8")))
    defines = {name: False for name in re.findall(r"[A-Za-z_]\w*", conditions)}
    root = grd_reader.Parse(str(grd), dir=str(grd.parent), debug=False, defines=defines)
    return [
        node.GetCliques()[0].GetId()
        for node in root.Preorder()
        if isinstance(node, message.MessageNode)
    ]


def rewrite(path, edit):
    before = path.read_bytes().decode("utf-8")
    after = edit(before)
    if after == before:
        return False
    path.write_bytes(after.encode("utf-8"))
    return True


def brand_strings(src):
    sys.path.insert(0, str(src / "tools" / "grit"))
    changed = []
    for relative in STRING_FILES:
        grd = src / relative
        old_ids = message_ids(grd)
        if rewrite(grd, lambda text: NAME.sub("Orbit", text)):
            changed.append(grd)
        new_ids = message_ids(grd)
        if len(old_ids) != len(new_ids):
            sys.exit(f"{relative}: message count changed from {len(old_ids)} to {len(new_ids)}")
        renamed = {old: new for old, new in zip(old_ids, new_ids) if old != new}
        print(f"{relative}: {len(renamed)} of {len(new_ids)} messages renamed")

        def edit(text):
            text = TRANSLATION_ID.sub(
                lambda m: f'<translation id="{renamed.get(m.group(1), m.group(1))}"', text
            )
            return NAME.sub("Orbit", text)

        xtbs = XTB.findall(grd.read_text(encoding="utf-8"))
        if not xtbs:
            sys.exit(f"{relative}: no translation files listed")
        for xtb in xtbs:
            path = grd.parent / xtb
            if rewrite(path, edit):
                changed.append(path)
    return changed


def grd_parts(grd):
    return [grd.parent / part for part in PART.findall(grd.read_text(encoding="utf-8"))]


def rename_chrome(src):
    """Renames "Chrome" to "Orbit" in shared strings, and only in the translations of messages
    whose English text changed."""
    sys.path.insert(0, str(src / "tools" / "grit"))
    changed = []
    for relative in CHROME_STRING_FILES:
        grd = src / relative
        old_ids = message_ids(grd)
        for path in [grd, *grd_parts(grd)]:
            if rewrite(path, lambda text: CHROME.sub("Orbit", text)):
                changed.append(path)
        new_ids = message_ids(grd)
        if len(old_ids) != len(new_ids):
            sys.exit(f"{relative}: message count changed from {len(old_ids)} to {len(new_ids)}")
        renamed = {old: new for old, new in zip(old_ids, new_ids) if old != new}
        print(f"{relative}: {len(renamed)} of {len(new_ids)} messages renamed")

        def edit(text):
            def one(m):
                if m.group(2) not in renamed:
                    return m.group(0)
                return m.group(1) + renamed[m.group(2)] + m.group(3) + CHROME.sub("Orbit", m.group(4)) + m.group(5)

            return TRANSLATION.sub(one, text)

        xtbs = XTB.findall(grd.read_text(encoding="utf-8"))
        if not xtbs:
            sys.exit(f"{relative}: no translation files listed")
        for xtb in xtbs:
            path = grd.parent / xtb
            if rewrite(path, edit):
                changed.append(path)
    return changed


def png_width(path):
    return int.from_bytes(path.read_bytes()[16:20], "big")


def mac_icons(src):
    theme = src / "chrome/app/theme/chromium/mac"
    with tempfile.TemporaryDirectory() as work:
        work = pathlib.Path(work)
        catalog = work / "Assets.xcassets"
        shutil.copytree(theme / "Assets.xcassets", catalog)
        for png in catalog.rglob("*.png"):
            shutil.copyfile(FORK / "mac-icons" / f"icon_{png_width(png)}.png", png)
        compiled = work / "compiled"
        compiled.mkdir()
        subprocess.run(
            [
                "xcrun", "actool", "--compile", str(compiled),
                "--platform", "macosx",
                "--minimum-deployment-target", "12.0",
                "--app-icon", "AppIcon",
                "--output-partial-info-plist", str(work / "partial.plist"),
                str(catalog),
            ],
            check=True,
        )
        shutil.copyfile(compiled / "Assets.car", theme / "Assets.car")
    return [theme / "Assets.car"]


def main():
    src = pathlib.Path(sys.argv[1]).resolve()
    changed = copy_overlay(src) + apply_patches(src) + brand_strings(src) + rename_chrome(src)
    if sys.platform == "darwin":
        changed += mac_icons(src)
    hashes = {
        path.relative_to(src).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(set(changed))
    }
    (src / "orbit-fork-files.json").write_text(json.dumps(hashes, indent=1, sort_keys=True))
    print(f"{len(hashes)} files changed")


if __name__ == "__main__":
    main()
