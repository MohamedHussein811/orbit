# Orbit's Chromium changes

Orbit is built from Google's official Chromium source archive, with these changes applied on top by
`tools/chromium/apply-fork.py`:

| Path | What |
| --- | --- |
| `overlay/` | Files copied over the source tree at the same paths: the `BRANDING` file, Orbit's logos in place of the unbranded Chromium ones, and the build target that ships the built-in extension |
| `patches/` | Source patches, applied in the order listed in `series` |
| `mac-icons/` | Logo sizes used to rebuild the macOS asset catalog (`Assets.car`) during the build |

The script also renames the product in Chromium's branded strings (`chromium_strings.grd`,
`components_chromium_strings.grd`) and in their translations, keeping each translation matched to
its renamed message. "The Chromium Authors" and ChromiumOS names stay as they are.

## Patches

| Patch | What |
| --- | --- |
| `orbit-names.patch` | Orbit's own data folders and Windows registration names, so Orbit and Chromium can be installed side by side |
| `orbit-builtin-extension.patch` | Installs the extensions in `resources/orbit_extensions` into every profile as built-in extensions: always on, not removable, pinned to the toolbar once, and without the "an extension changed your new tab page" prompt |
| `orbit-settings.patch` | Removes Settings parts for Google services Orbit does not use: the AI page, Safety Check, Privacy Guide, the Safe Browsing section, the password leak check, sync and Google services rows, and the "Get help" link |
| `orbit-privacy-defaults.patch` | Default settings (DuckDuckGo search, secure DNS through Quad9, HTTPS only, no Safe Browsing pings to Google, no prediction, translation or sign-in, no extensions that other programs registered for Chrome or Chromium), default switches and disabled AI and advertising web APIs, no warning about missing Google API keys, light or dark following the device, and DuckDuckGo as the default search engine even though Google is in the list |
| `orbit-theme.patch` | Orbit's color palette for the whole browser in place of Chromium's default one (generated into `overlay/ui/color/orbit_palette.inc` by `tools/design/tokens.mjs`). Settings keeps Chromium's Light, Dark and Device modes |
| `orbit-pages.patch` | Orbit's palette for error pages, security warnings and the private window page |
| `orbit-scheme.patch` | The address bar shows internal pages as `orbit://`, and Orbit's own extension pages as `orbit://<page>` (such as `orbit://privacy`); a typed `orbit://` address opens them. Web pages cannot open internal pages with either scheme |
| `orbit-tabs.patch` | Tabs are pills that float in the tab strip, the active tab included, with no separator lines |
| `orbit-window.patch` | One top row: the toolbar moves into the title bar row with a fixed-width address bar, and the tabs sit in the rest of that row. A thin horizon line (periwinkle, amber, rose) runs under it. The row takes the frame color so the active tab stands out as a pill. A rail on the leading edge below the row holds Orbit's mark and Home, Privacy, Bookmarks (side panel), History, Downloads, Notes (side panel) and Settings. Also turns on Chromium's 2026 WebUI refresh by default |
| `orbit-installer.patch` | On Windows the browser is `orbit.exe` (its file, version info, installer file names, App Paths entry and tile manifest), and Chromium's installer carries Orbit's built-in extension |
| `orbit-media.patch` | Windows and macOS: H.264 through the GPU's D3D11 decoder or VideoToolbox, AAC through Media Foundation or AudioToolbox, with Chromium's FFmpeg reading MP4. `tools/chromium/args.sh` turns on proprietary codecs for both |
| `orbit-error-page.patch` | Error pages show Orbit's ring with its satellite drifted away instead of Chromium's pixel picture. The offline game keeps its art |
| `orbit-shields-counts.patch` | Lets Orbit's built-in extension (and no other) receive the rule-match events Shields counts blocks with, which Chromium otherwise gives only to unpacked extensions |

Defaults change only the default value. A choice made in Settings still wins.

## Built-in extension

The dashboard and Shields come from `extension/`. `tools/chromium/pack-extension.mjs` packs it as a
signed CRX3 file. The signing key fixes the extension's ID (`kceipbaiojomdibnboffoieecidpfdck`) and
comes from the `ORBIT_EXTENSION_KEY` secret. Losing the key means a new ID, and people would lose
the extension's saved data on the next update.

`tools/chromium/make-icons.ps1` regenerates `overlay/` logos and `mac-icons/` from `branding/`.
`tools/design/browser-icons.mjs` writes Orbit's toolbar and tab icons into `overlay/` as Chromium
`.icon` files.
The builds run in `.github/workflows/browser-*.yml`.
