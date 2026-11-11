# Orbit's Chromium changes

Orbit is built from Google's official Chromium source archive, with these changes applied on top by
`tools/chromium/apply-fork.py`:

| Path | What |
| --- | --- |
| `overlay/` | Files copied over the source tree at the same paths: the `BRANDING` file and Orbit's logos in place of the unbranded Chromium ones |
| `patches/` | Source patches, applied in the order listed in `series` |
| `mac-icons/` | Logo sizes used to rebuild the macOS asset catalog (`Assets.car`) during the build |

The script also renames the product in Chromium's branded strings (`chromium_strings.grd`,
`components_chromium_strings.grd`) and in their translations, keeping each translation matched to
its renamed message. "The Chromium Authors" and ChromiumOS names stay as they are.

`tools/chromium/make-icons.ps1` regenerates `overlay/` logos and `mac-icons/` from `branding/`.
The builds run in `.github/workflows/browser-*.yml`.
