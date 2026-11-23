#!/usr/bin/env python3
"""Android's own changes on top of apply-fork.py: the patches in tools/android/patches (applied in
the order of their series file), the app name and the launcher icons.

usage: brand.py <chromium src folder>

Run after tools/chromium/apply-fork.py. The icons are rendered from branding/orbit-mark.svg with
rsvg-convert. The changed files are added to orbit-fork-files.json for date-fork.py.
"""

import hashlib
import importlib.util
import json
import re
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]
RES = "chrome/android/java/res_chromium_base"
# Folders holding the grd files that make Android string resources, and the grd conditions that
# are true in Orbit's Android build (is_desktop_android turns on extensions; ARCore is on by default).
STRING_ROOTS = ("chrome", "components", "ui", "content", "device", "services")
ENABLED_CONDITIONS = ("enable_extensions_core", "enable_arcore")
# Android string files that say Incognito; Orbit says private (apply-fork.py rename_incognito).
INCOGNITO_STRING_FILES = (
    "chrome/browser/ui/android/strings/android_chrome_strings.grd",
    "chrome/android/features/tab_ui/java/strings/android_chrome_tab_ui_strings.grd",
    "components/browser_ui/strings/android/browser_ui_strings.grd",
)
PRIVACY_URL = "https://github.com/MohamedHussein811/orbit/blob/main/PRIVACY.md"
# Settings > About > Legal information: Orbit's privacy policy instead of Google's.
LEGAL_MESSAGES = {
    "IDS_PRIVACY_POLICY_TITLE": ("Google Privacy Policy", "Orbit Privacy Policy"),
    "IDS_GOOGLE_PRIVACY_POLICY_URL": ("https://policies.google.com/privacy", PRIVACY_URL),
    "IDS_LEGAL_INFORMATION_SUMMARY": (
        'Copyright <ph name="year">%1$d<ex>2014</ex></ph> Google LLC. All rights reserved.',
        'Copyright <ph name="year">%1$d<ex>2014</ex></ph> NovaTech and The Chromium Authors. All rights reserved.',
    ),
}
# Orbit's own Android strings (orbit-android-settings.patch uses them): name, description, English,
# Arabic. Added after ORBIT_MESSAGES_AFTER in ORBIT_STRINGS.
ORBIT_STRINGS = "chrome/browser/ui/android/strings/android_chrome_strings.grd"
ORBIT_MESSAGES_AFTER = "IDS_PREFS_SECTION_ADVANCED"
ORBIT_MESSAGES = (
    (
        "IDS_ORBIT_SETTINGS_GET_STARTED",
        "Title of the first section of Settings, with the default browser and the pages opened at startup. [CHAR_LIMIT=32]",
        "Get Started",
        "البدء",
    ),
    (
        "IDS_ORBIT_SETTINGS_ON_STARTUP",
        "Settings row that opens the choice of pages the browser opens when it starts. [CHAR_LIMIT=32]",
        "On startup",
        "عند بدء التشغيل",
    ),
)
BACKGROUND = "#0b0b0d"
GLYPH = (
    '<path d="M385.43 221.32 A134 134 0 1 1 290.68 126.57" fill="none" stroke="{color}" '
    'stroke-width="46" stroke-linecap="round"/><circle cx="350.75" cy="161.25" r="30" fill="{color}"/>'
)
# The glyph's box in orbit-mark.svg's 512 grid, and its size on the 108 grid of an adaptive icon.
GLYPH_BOX = (96, 320)
ADAPTIVE_GLYPH = 44
DENSITIES = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
# Chromium's incognito hat, redrawn as Orbit's private mark: vector drawables (True: a filled
# disc with the mark cut out) and bitmaps (mark color, disc color or None for no disc).
PRIVATE_VECTORS = (
    ("components/browser_ui/styles/android/java/res/drawable/ic_incognito_24dp.xml", False),
    ("components/browser_ui/styles/android/java/res/drawable/ic_incognito_fill_18dp.xml", False),
    ("components/browser_ui/styles/android/java/res/drawable/ic_incognito_fill_24dp.xml", False),
    ("components/browser_ui/styles/android/java/res/drawable/ic_incognito_circle_fill_24dp.xml", True),
)
PRIVATE_PNGS = {
    "incognito_splash": ("#ffffff", None),
    "location_bar_incognito_badge": ("#ffffff", "#24252c"),
    "shortcut_incognito": ("#9eacff", "#131418"),
}
# Chromium logos in the app's screens: the icon of new tab pages in the tab switcher and the blue
# Chromium logo. The tab switcher tints its icon to one color and keeps only its shape, so that
# one is the glyph alone on a transparent background; the full mark would become a plain square.
LOGO_PNGS = (
    ("chrome/browser/ui/android/favicon/java/res/drawable-{density}/chromelogo16.png", "glyph"),
    ("chrome/android/java/res/drawable-{density}/chrome_logo_blue.png", "mark"),
)
GLYPH_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="80 80 352 352">'
    + GLYPH.format(color="#ffffff")
    + "</svg>"
)

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


def private_mark(k=1.0, ox=0.0, oy=0.0):
    """Orbit's private mark as filled SVG path data: the orbit arc of Orbit's mark (round ends),
    its dot, and a crescent moon inside, on the 512 grid of orbit-mark.svg, scaled by k and moved
    by (ox, oy)."""
    def p(x, y):
        return f"{x * k + ox:.2f},{y * k + oy:.2f}"

    def r(value):
        return f"{value * k:.2f}"

    ring = (
        f"M{p(407.65, 215.37)}A{r(157)},{r(157)} 0 1 1 {p(296.64, 104.35)}"
        f"A{r(23)},{r(23)} 0 0 1 {p(284.73, 148.78)}"
        f"A{r(111)},{r(111)} 0 1 0 {p(363.22, 227.27)}"
        f"A{r(23)},{r(23)} 0 0 1 {p(407.65, 215.37)}Z"
    )
    dot = f"M{p(320.75, 161.25)}A{r(30)},{r(30)} 0 1 0 {p(380.75, 161.25)}A{r(30)},{r(30)} 0 1 0 {p(320.75, 161.25)}Z"
    moon = f"M{p(325.73, 273.95)}A{r(72)},{r(72)} 0 1 1 {p(238.05, 186.27)}A{r(62)},{r(62)} 0 1 0 {p(325.73, 273.95)}Z"
    return [ring, dot, moon]


def private_vector(original, circle):
    """An incognito vector drawable redrawn as Orbit's private mark, keeping its size, tint and
    fill color. `circle` draws a filled disc with the mark cut out."""
    head = re.search(r"<vector\b.*?>", original, re.DOTALL)
    color = re.search(r'android:fillColor="([^"]+)"', original)
    box = re.search(r'android:viewportWidth="([\d.]+)"', original)
    if not head or not color or not box or float(box.group(1)) != 960:
        sys.exit("incognito drawable: unexpected format")
    if circle:
        disc = "M480,80A400,400 0 1 1 480,880A400,400 0 1 1 480,80Z"
        data = disc + "".join(private_mark(1.375, 128, 128))
        body = f'  <path\n      android:fillColor="{color.group(1)}"\n      android:fillType="evenOdd"\n      android:pathData="{data}"/>\n'
    else:
        body = f'  <path\n      android:fillColor="{color.group(1)}"\n      android:pathData="{"".join(private_mark(2.25, -96, -96))}"/>\n'
    return f'<?xml version="1.0" encoding="utf-8"?>\n{head.group(0)}\n{body}</vector>\n'


def private_svg(glyph, disc=None):
    paths = "".join(f'<path d="{d}" fill="{glyph}"/>' for d in private_mark())
    if disc:
        return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="256" fill="{disc}"/><g transform="translate(256 256) scale(0.7) translate(-256 -256)">{paths}</g></svg>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><g transform="translate(256 256) scale(0.8) translate(-256 -256)">{paths}</g></svg>'


def private_icons(src):
    """Orbit's private mark in place of Chromium's incognito hat."""
    changed = []
    for relative, circle in PRIVATE_VECTORS:
        target = src / relative
        target.write_text(private_vector(target.read_text(encoding="utf-8"), circle), encoding="utf-8")
        changed.append(target)
    with tempfile.TemporaryDirectory() as work:
        for name, colors in PRIVATE_PNGS.items():
            svg = pathlib.Path(work) / f"{name}.svg"
            svg.write_text(private_svg(*colors))
            for density in DENSITIES:
                target = src / f"chrome/android/java/res/drawable-{density}/{name}.png"
                if not target.exists():
                    sys.exit(f"{target}: missing in the source")
                width, height = png_size(target)
                if width != height:
                    sys.exit(f"{target}: not square ({width}x{height})")
                render(svg, width, target)
                changed.append(target)
    return changed


def png_size(path):
    data = path.read_bytes()[:24]
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        sys.exit(f"{path}: not a PNG")
    return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big")


def orbit_logos(src):
    """Chromium logos drawn in Orbit's own screens become Orbit's mark at the same pixel size."""
    changed = []
    with tempfile.TemporaryDirectory() as work:
        glyph = pathlib.Path(work) / "glyph.svg"
        glyph.write_text(GLYPH_SVG)
        sources = {"glyph": glyph, "mark": ROOT / "branding" / "orbit-mark.svg"}
        for pattern, kind in LOGO_PNGS:
            for density in DENSITIES:
                target = src / pattern.format(density=density)
                if not target.exists():
                    sys.exit(f"{target}: missing in the source")
                width, height = png_size(target)
                if width != height:
                    sys.exit(f"{target}: not square ({width}x{height})")
                render(sources[kind], width, target)
                changed.append(target)
    return changed


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


def apply_fork():
    spec = importlib.util.spec_from_file_location("apply_fork", ROOT / "tools" / "chromium" / "apply-fork.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def android_string_files(src, fork):
    """Translated grd files that produce Android string resources and name the browser, with or
    without "Google" in front (apply-fork.py leaves "Google Chrome" in the shared strings)."""
    name = android_name(fork)
    found = []
    for root in STRING_ROOTS:
        for grd in sorted((src / root).rglob("*.grd")):
            relative = grd.relative_to(src).as_posix()
            if "/test" in relative or "testdata" in relative:
                continue
            text = grd.read_text(encoding="utf-8", errors="replace")
            if 'type="android"' not in text or not fork.XTB.search(text):
                continue
            sources = [grd, *fork.grd_parts(grd)]
            if any(name.search(path.read_text(encoding="utf-8", errors="replace")) for path in sources):
                found.append(relative)
    return found


GOOGLE_CHROME = re.compile(r"Google(?: |&nbsp;| )Chrome")


def google_chrome_in_translations(src, relative, fork):
    """"Google Chrome" in any translation of the grd: some translators name the product where the
    English text does not. The phrase is never another product, unlike a bare "Chrome"."""
    grd = src / relative
    changed = []

    def edit(text):
        return fork.TRANSLATION.sub(
            lambda m: m.group(1) + m.group(2) + m.group(3) + GOOGLE_CHROME.sub("Orbit", m.group(4)) + m.group(5), text
        )

    for xtb in fork.XTB.findall(grd.read_text(encoding="utf-8")):
        path = grd.parent / xtb
        if fork.rewrite(path, edit):
            changed.append(path)
    return changed


def android_name(fork):
    """apply-fork.py's browser name pattern, plus "Google Chrome": on Android it always names the
    app itself (menu descriptions, shortcut help), never another browser to import from."""
    core = fork.CHROME.pattern.replace("(?<!Google )(?<!Google&nbsp;)", "")
    if core == fork.CHROME.pattern:
        sys.exit("apply-fork.py: the CHROME pattern changed; update android_name")
    return re.compile(r"(?:Google(?: |&nbsp;))?" + core)


def legal_messages(text):
    for name, (old, new) in LEGAL_MESSAGES.items():
        pattern = re.compile(r'(<message name="' + name + r'"[^>]*>\s*)' + re.escape(old) + r"(\s*</message>)")
        text, count = pattern.subn(lambda m: m.group(1) + new + m.group(2), text)
        if count != 1:
            sys.exit(f"{name}: expected text not found")
    return text


def add_orbit_messages(src):
    """Adds Orbit's own Android strings (ORBIT_MESSAGES) to the Chrome strings, with their Arabic
    translations; other languages show the English text."""
    fork = apply_fork()
    sys.path.insert(0, str(src / "tools" / "grit"))
    grd = src / ORBIT_STRINGS
    text = grd.read_text(encoding="utf-8")
    anchor = re.search(r'<message name="' + ORBIT_MESSAGES_AFTER + r'"[^>]*>.*?</message>\n', text, re.DOTALL)
    if not anchor:
        sys.exit(f"{grd}: {ORBIT_MESSAGES_AFTER} not found")
    old_ids = set(fork.message_ids(grd, ENABLED_CONDITIONS))
    block = "".join(
        f'      <message name="{name}" desc="{desc}">\n        {english}\n      </message>\n'
        for name, desc, english, _ in ORBIT_MESSAGES
    )
    grd.write_text(text[: anchor.end()] + block + text[anchor.end() :], encoding="utf-8")
    added = [i for i in fork.message_ids(grd, ENABLED_CONDITIONS) if i not in old_ids]
    if len(added) != len(ORBIT_MESSAGES):
        sys.exit(f"{grd}: {len(added)} new message ids for {len(ORBIT_MESSAGES)} messages")
    arabic = re.search(r'<file path="([^"]+)" lang="ar"', text)
    if not arabic:
        sys.exit(f"{grd}: no Arabic translation file")
    xtb = grd.parent / arabic.group(1)
    rows = "".join(f'<translation id="{i}">{m[3]}</translation>\n' for i, m in zip(added, ORBIT_MESSAGES))
    xtb_text = xtb.read_text(encoding="utf-8")
    if "</translationbundle>" not in xtb_text:
        sys.exit(f"{xtb}: no translation bundle end")
    xtb.write_text(xtb_text.replace("</translationbundle>", rows + "</translationbundle>", 1), encoding="utf-8")
    print(f"Orbit strings: {len(added)} added")
    return [grd, xtb]


def brand_android_strings(src):
    """Renames "Chrome" and "Chromium" used as the browser's name in the Android string resources,
    with the same translation handling as the desktop strings (apply-fork.py)."""
    fork = apply_fork()
    sys.path.insert(0, str(src / "tools" / "grit"))
    changed = fork.rename_messages(
        src,
        "chrome/browser/ui/android/strings/android_chrome_strings.grd",
        legal_messages,
        lambda text: text.replace("Google LLC", "NovaTech and The Chromium Authors").replace("Google", "Orbit"),
        enabled=ENABLED_CONDITIONS,
    )
    files = android_string_files(src, fork)
    if not files:
        sys.exit("no Android string files found")
    name = android_name(fork)

    def rename(text):
        return name.sub("Orbit", text)

    for relative in files:
        changed += fork.rename_messages(src, relative, rename, rename, enabled=ENABLED_CONDITIONS)
        changed += google_chrome_in_translations(src, relative, fork)
    changed += fork.rename_incognito(src, INCOGNITO_STRING_FILES, ENABLED_CONDITIONS)
    kept = set()
    for relative in files:
        for path in [src / relative, *fork.grd_parts(src / relative)]:
            for body in re.findall(r"<message [^>]*>(.*?)</message>", path.read_text(encoding="utf-8"), re.DOTALL):
                kept.update(re.findall(r"(?:Google )?Chrom\w*(?: \w+)?", body))
    print(f"Android strings: {len(files)} grd files, {len(changed)} files changed")
    print(f"Android strings: names kept (other products): {sorted(kept)}")
    return changed


def main():
    src = pathlib.Path(sys.argv[1]).resolve()
    res = src / RES
    changed = apply_patches(src)
    changed += apply_palette(src)
    changed += brand_android_strings(src)
    changed += add_orbit_messages(src)

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

    changed += orbit_logos(src)
    changed += private_icons(src)

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
