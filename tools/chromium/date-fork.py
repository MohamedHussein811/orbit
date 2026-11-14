#!/usr/bin/env python3
"""Dates Orbit's changed source files against a restored build, so ninja rebuilds only real changes.

usage: date-fork.py <chromium src folder>

A file that differs from what the restored build used, or that the restored build did not have,
gets the current time. Every other file gets an old time. The current list is then kept in out/,
so it is saved with the build for the next stage.
"""

import json
import os
import pathlib
import shutil
import sys
import time

OLD = 946684800


def main():
    src = pathlib.Path(sys.argv[1]).resolve()
    current = json.loads((src / "orbit-fork-files.json").read_text())
    saved_path = src / "out" / "orbit-fork-files.json"
    saved = json.loads(saved_path.read_text()) if saved_path.exists() else {}
    now = time.time()
    changed = []
    for relative, digest in current.items():
        fresh = saved.get(relative) != digest
        stamp = now if fresh else OLD
        os.utime(src / relative, (stamp, stamp))
        if fresh:
            changed.append(relative)
    shutil.copyfile(src / "orbit-fork-files.json", saved_path)
    print(f"{len(changed)} of {len(current)} Orbit files differ from the restored build")
    for relative in changed[:50]:
        print(f"  {relative}")


if __name__ == "__main__":
    main()
