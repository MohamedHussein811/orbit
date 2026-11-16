#!/usr/bin/env python3
"""Dates Orbit's changed source files against a restored build, so ninja rebuilds only real changes.

usage: date-fork.py <chromium src folder>

Each Orbit file keeps the time it first took its current contents: a file that differs from what
the restored build recorded gets the current time, and a file that is the same gets the time it had
when it last changed. A stage that runs out of time before rebuilding everything that depends on a
changed file therefore leaves that work for the next stage. The list is kept in out/, so it is
saved with the build for the next stage.
"""

import json
import os
import pathlib
import sys
import time


def main():
    src = pathlib.Path(sys.argv[1]).resolve()
    current = json.loads((src / "orbit-fork-files.json").read_text())
    saved_path = src / "out" / "orbit-fork-files.json"
    saved = json.loads(saved_path.read_text()) if saved_path.exists() else {}
    now = time.time()
    record = {}
    changed = []
    for relative, digest in current.items():
        before = saved.get(relative)
        # Lists from older builds hold only digests and no times, so their files count as changed.
        if isinstance(before, dict) and before.get("sha256") == digest:
            stamp = before["time"]
        else:
            stamp = now
            changed.append(relative)
        os.utime(src / relative, (stamp, stamp))
        record[relative] = {"sha256": digest, "time": stamp}
    # Files Orbit no longer changes are back to Chromium's own contents, which carry the archive's
    # older time, so the restored build would keep the objects built from Orbit's version.
    for relative, before in saved.items():
        if relative in current:
            continue
        if isinstance(before, dict) and before.get("upstream"):
            stamp = before["time"]
        else:
            stamp = now
            changed.append(relative)
        if (src / relative).exists():
            os.utime(src / relative, (stamp, stamp))
        record[relative] = {"upstream": True, "time": stamp}
    saved_path.write_text(json.dumps(record, indent=1, sort_keys=True))
    print(f"{len(changed)} of {len(current)} Orbit files differ from the restored build")
    for relative in changed[:50]:
        print(f"  {relative}")


if __name__ == "__main__":
    main()
