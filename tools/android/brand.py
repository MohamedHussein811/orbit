#!/usr/bin/env python3
"""Android's own changes on top of apply-fork.py: the patches in tools/android/patches (applied in
the order of their series file), the app name and the launcher icons.

usage: brand.py <chromium src folder>

Run after tools/chromium/apply-fork.py. The icons are rendered from branding/orbit-mark.svg with
rsvg-convert. The changed files are added to orbit-fork-files.json for date-fork.py.
"""

import hashlib
import json
import re
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
RES = "chrome/android/java/res_chromium_base"
BACKGROUND = "#0b0b0d"
GLYPH = (
    '<path d="M385.43 221.32 A134 134 0 1 1 290.68 126.57" fill="none" stroke="{color}" '
    'stroke-width="46" stroke-linecap="round"/><circle cx="350.75" cy="161.25" r="30" fill="{color}"/>'
)
# The glyph's box in orbit-mark.svg's 512 grid, and its size on the 108 grid of an adaptive icon.
GLYPH_BOX = (96, 320)
ADAPTIVE_GLYPH = 44
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}

ADAPTIVE_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">'
    f'<rect width="108" height="108" fill="{BACKGROUND}"/>'
    f'<g transform="translate(54 54) scale({ADAPTIVE_GLYPH / GLYPH_BOX[1]}) translate(-256 -256)">'
    + GLYPH.format(color="#ffffff")
    + "</g></svg>"
)


def themed_icon():
    """The one-color icon Android 13 tints to the wallpaper: the glyph inside the 36 unit box
    at 27 of a 90 unit canvas, as Chromium's own themed icon is laid out."""
    scale = 36 / GLYPH_BOX[1]
    shift = 27 - GLYPH_BOX[0] * scale
    return f"""<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="90dp"
    android:height="90dp"
    android:viewportWidth="90"
    android:viewportHeight="90">
    <group
        android:scaleX="{scale:.6f}"
        android:scaleY="{scale:.6f}"
        android:translateX="{shift:.4f}"
        android:translateY="{shift:.4f}">
        <path
            android:pathData="M385.43,221.32A134,134 0,1 1,290.68 126.57"
            android:strokeColor="#000000"
            android:strokeWidth="46"
            android:strokeLineCap="round"/>
        <path
            android:pathData="M320.75,161.25a30,30 0,1 0,60 0a30,30 0,1 0,-60 0z"
            android:fillColor="#000000"/>
    </group>
</vector>
"""


def render(svg, size, out):
    subprocess.run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", str(out), str(svg)], check=True)


def apply_patches(src):
    folder = ROOT / "tools" / "android" / "patches"
    changed = []
    for name in (folder / "series").read_text().split():
        patch = folder / name
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


def apply_palette(src):
    """Orbit's colors (tools/android/orbit-palette.json, written by tools/design/tokens.mjs) in
    Chromium's Android palette: day values replace color_palette.xml's, night values go to a
    values-night file of the same colors."""
    palette = json.loads((ROOT / "tools" / "android" / "orbit-palette.json").read_text())
    values = src / "ui" / "android" / "java" / "res" / "values" / "color_palette.xml"
    text = values.read_text(encoding="utf-8")
    entry = re.compile(r'(<color name="([^"]+)"[^>]*>)([^<]*)(</color>)')
    alpha = re.compile(r"(.+)_alpha_\d+$")

    # A color, or a translucent copy of one (name_alpha_N keeps its alpha byte), from a palette.
    def value(name, current, colors):
        if name in colors:
            return colors[name]
        base = alpha.match(name)
        if base and base.group(1) in colors and re.fullmatch(r"#[0-9A-Fa-f]{8}", current):
            return current[:3] + colors[base.group(1)][1:]
        return None

    replaced = 0
    night_rows = []

    def swap(match):
        nonlocal replaced
        name, current = match.group(2), match.group(3).strip()
        day = value(name, current, palette["light"])
        dark = value(name, current, palette["dark"])
        if dark is not None:
            night_rows.append(f'    <color name="{name}">{dark}</color>')
        if day is None:
            return match.group(0)
        replaced += 1
        return f"{match.group(1)}{day}{match.group(4)}"

    text = entry.sub(swap, text)
    if replaced < 50:
        sys.exit(f"{values}: only {replaced} palette colors replaced")
    values.write_text(text, encoding="utf-8")

    # Chromium's build only takes resource files its BUILD.gn lists, so the night values join the
    # folder's existing night colors file.
    night = values.parent.parent / "values-night" / "colors.xml"
    text = night.read_text(encoding="utf-8")
    clash = set(re.findall(r'<color name="([^"]+)"', text)) & {row.split('"')[1] for row in night_rows}
    if clash or "</resources>" not in text:
        sys.exit(f"{night}: cannot add the night palette ({sorted(clash)[:5]})")
    text = text.replace("</resources>", "\n".join(night_rows) + "\n</resources>", 1)
    night.write_text(text, encoding="utf-8")
    print(f"palette: {replaced} day colors, {len(night_rows)} night colors")
    return [values, night]


def main():
    src = pathlib.Path(sys.argv[1]).resolve()
    res = src / RES
    changed = apply_patches(src)
    changed += apply_palette(src)

    constants = res / "values" / "channel_constants.xml"
    text = constants.read_text(encoding="utf-8")
    branded = text.replace(">Chromium", ">Orbit")
    if branded == text:
        sys.exit(f"{constants}: no Chromium names found")
    constants.write_text(branded, encoding="utf-8")
    changed.append(constants)

    themed = res / "drawable" / "themed_app_icon.xml"
    themed.write_text(themed_icon(), encoding="utf-8")
    changed.append(themed)

    with tempfile.TemporaryDirectory() as work:
        adaptive = pathlib.Path(work) / "adaptive.svg"
        adaptive.write_text(ADAPTIVE_SVG)
        for density, factor in DENSITIES.items():
            folder = res / f"mipmap-{density}"
            for name, svg, size in (
                ("app_icon", ROOT / "branding" / "orbit-mark.svg", 48),
                ("layered_app_icon", adaptive, 108),
                ("layered_app_icon_background", adaptive, 108),
            ):
                target = folder / f"{name}.png"
                if not target.exists():
                    sys.exit(f"{target}: missing in the source")
                render(svg, round(size * factor), target)
                changed.append(target)

    record = src / "orbit-fork-files.json"
    hashes = json.loads(record.read_text())
    for path in changed:
        hashes[path.relative_to(src).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    record.write_text(json.dumps(hashes, indent=1, sort_keys=True))
    print(f"{len(changed)} Android files changed")


if __name__ == "__main__":
    main()
