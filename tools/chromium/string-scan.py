#!/usr/bin/env python3
"""Lists user-visible strings that still name Chrome, Chromium, Google, Gemini or Incognito, or
show chrome://, after Orbit's string passes.

  python tools/chromium/string-scan.py <src> desktop|android [--json out.json] [--all]

<src> is a Chromium tree, or the grd subset research/patch-builders/fetch-grd.mjs fetches. The grd
files and their translations are copied to a temporary folder and the passes the build runs are
applied there (apply-fork.py; brand.py too for android), so <src> is not changed. Messages are
read with grit under the platform's conditions; English and Arabic are checked. Missing grds and
translation files are skipped and reported. --all also prints the allowlisted hits."""
import importlib.util
import json
import pathlib
import re
import shutil
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[2]

DESKTOP_GRDS = [
    "chrome/app/generated_resources.grd",
    "chrome/app/chromium_strings.grd",
    "components/components_strings.grd",
    "components/components_chromium_strings.grd",
    "ui/strings/ui_strings.grd",
    "extensions/strings/extensions_strings.grd",
]
ANDROID_GRDS = DESKTOP_GRDS[:4] + [
    "chrome/browser/ui/android/strings/android_chrome_strings.grd",
    "chrome/android/features/tab_ui/java/strings/android_chrome_tab_ui_strings.grd",
    "chrome/browser/tab_ui/android/java/strings/android_tab_ui_strings.grd",
    "components/browser_ui/strings/android/browser_ui_strings.grd",
    "components/permissions/android/permissions_android_strings.grd",
    "components/webapps/browser/android/android_webapps_strings.grd",
    "ui/android/java/strings/android_ui_strings.grd",
]

# Conditions that are true in Orbit's builds. Platform names come from grit's target platform.
DESKTOP_OFF = {"use_titlecase", "_google_chrome", "_is_chrome_for_testing_branded", "reven", "is_cfm",
               "enable_vr", "enable_cardboard", "enable_arcore", "enable_pdf_save_to_drive"}
DESKTOP_PLATFORMS = ("win32", "linux", "darwin")
ANDROID_ON = {"enable_extensions_core", "enable_arcore"}

WORDS = re.compile(r"\b(?:Chrom(?:e|ium)\w*|Google|Gemini|Incognito|INCOGNITO)\b|chrome://|"
                   r"كروم|غوغل|جوجل|متخف|المتخفي")
# Names that are other products or required credits, not the browser or a Google service.
ALLOWED = re.compile(
    r"Chrome Web Store|Chromium Authors|ChromeOS|Chrome OS|Chromebook|Chrome Remote Desktop|"
    r"Chrome Root Store|Chromecast|chrome://flags|Google Chrome(?= (?:bookmarks|data|browser data))|"
    r"from Google Chrome|Google Chrome and|and Google Chrome|Chrome Apps?\b|Chrome apps?\b"
)


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def copy_grds(src, work, grds, fork, missing):
    for relative in grds:
        grd = src / relative
        if not grd.exists():
            missing.append(relative)
            continue
        for path in [grd, *fork.grd_parts(grd)]:
            target = work / path.relative_to(src)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
        for xtb in fork.XTB.findall(grd.read_text(encoding="utf-8")):
            path = grd.parent / xtb
            if path.exists():
                target = work / path.relative_to(src)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)


def apply_passes(work, platform, fork):
    real_rewrite = fork.rewrite
    fork.rewrite = lambda path, edit: path.exists() and real_rewrite(path, edit)
    if (work / fork.STRING_FILES[0]).exists():
        fork.brand_strings(work)
        fork.about_version_names(work)
        fork.default_menu_item(work)
    present = [f for f in fork.CHROME_STRING_FILES if (work / f).exists()]
    saved = fork.CHROME_STRING_FILES
    fork.CHROME_STRING_FILES = present
    fork.rename_chrome(work)
    fork.CHROME_STRING_FILES = saved
    fork.rename_incognito(work, [f for f in fork.INCOGNITO_STRING_FILES if (work / f).exists()])
    if platform == "android":
        brand = load(ROOT / "tools" / "android" / "brand.py", "brand")
        brand.apply_fork = lambda: fork
        brand.INCOGNITO_STRING_FILES = tuple(f for f in brand.INCOGNITO_STRING_FILES if (work / f).exists())
        brand.brand_android_strings(work)
        if (work / brand.ORBIT_STRINGS).exists():
            brand.add_orbit_messages(work)


def arabic_translations(grd, fork):
    text = grd.read_text(encoding="utf-8")
    found = re.search(r'<file path="([^"]+)" lang="ar"', text)
    if not found or not (grd.parent / found.group(1)).exists():
        return None
    xtb = (grd.parent / found.group(1)).read_text(encoding="utf-8")
    return {m.group(2): re.sub(r"<ph[^>]*/>", "…", m.group(4)) for m in fork.TRANSLATION.finditer(xtb)}


def scan(work, relative, platform, fork):
    from grit import grd_reader
    from grit.node import message

    grd = work / relative
    sources = [grd, *fork.grd_parts(grd)]
    names = set()
    for path in sources:
        for expr in re.findall(r'<if expr="([^"]*)"', path.read_text(encoding="utf-8")):
            names.update(re.findall(r"[A-Za-z_]\w*", expr))
    if platform == "android":
        targets, on = ("android",), lambda n: n in ANDROID_ON
    else:
        targets, on = DESKTOP_PLATFORMS, lambda n: n.startswith(("enable_", "use_", "toolkit_", "chrome_")) and n not in DESKTOP_OFF
    defines = {n: on(n) for n in names}
    arabic = arabic_translations(grd, fork)
    hits = {}
    for target in targets:
        root = grd_reader.Parse(str(grd), dir=str(grd.parent), debug=False, defines=defines, target_platform=target)
        root.SetOutputLanguage("en")
        for node in root.ActiveDescendants():
            if not isinstance(node, message.MessageNode):
                continue
            clique = node.GetCliques()[0]
            english = clique.GetMessage().GetPresentableContent()
            translated = (arabic or {}).get(clique.GetId(), "")
            for lang, text in (("en", english), ("ar", translated)):
                if text and WORDS.search(text):
                    key = (node.attrs["name"], lang)
                    hits.setdefault(key, {"file": relative, "name": node.attrs["name"], "lang": lang,
                                          "text": " ".join(text.split()), "platforms": []})
                    hits[key]["platforms"].append(target)
    return list(hits.values()), arabic is not None


def allowed(text):
    rest = ALLOWED.sub("", text)
    return not WORDS.search(rest)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    if len(args) < 2 or args[1] not in ("desktop", "android"):
        sys.exit(__doc__)
    src = pathlib.Path(args[0]).resolve()
    platform = args[1]
    out = args[args.index("--json") + 1] if "--json" in args else None
    show_all = "--all" in args
    sys.path.insert(0, str(src / "tools" / "grit"))
    fork = load(ROOT / "tools" / "chromium" / "apply-fork.py", "apply_fork")
    grds = ANDROID_GRDS if platform == "android" else DESKTOP_GRDS
    missing = []
    with tempfile.TemporaryDirectory() as tmp:
        work = pathlib.Path(tmp)
        copy_grds(src, work, grds, fork, missing)
        apply_passes(work, platform, fork)
        results = []
        for relative in grds:
            if (work / relative).exists():
                hits, has_arabic = scan(work, relative, platform, fork)
                if not has_arabic:
                    missing.append(relative + " (Arabic translations)")
                results += hits
    for hit in results:
        hit["allowed"] = allowed(hit["text"])
    flagged = [h for h in results if show_all or not h["allowed"]]
    for hit in flagged:
        mark = "ok " if hit["allowed"] else ""
        print(f"{mark}{hit['file']} {hit['name']} [{hit['lang']}]: {hit['text']}")
    print(f"\n{platform}: {sum(not h['allowed'] for h in results)} flagged, "
          f"{sum(h['allowed'] for h in results)} allowlisted")
    for relative in missing:
        print(f"not scanned: {relative}")
    if out:
        pathlib.Path(out).write_text(json.dumps(results, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
