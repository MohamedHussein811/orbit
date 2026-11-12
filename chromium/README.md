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
| `orbit-privacy-defaults.patch` | Default settings (DuckDuckGo search, secure DNS through Quad9, HTTPS only, no Safe Browsing pings to Google, no prediction, translation or sign-in, no extensions that other programs registered for Chrome or Chromium), default switches and disabled AI and advertising web APIs, no warning about missing Google API keys, and the Space theme as the default |
| `orbit-theme.patch` | Orbit's color palette for the whole browser in place of Chromium's default one (generated into `overlay/ui/color/orbit_palette.inc` by `tools/design/tokens.mjs`), and a Theme choice in Settings: Space (Orbit's dark palette, the default), Dark (grey), Light and the device setting |

Defaults change only the default value. A choice made in Settings still wins.

## Built-in extension

The dashboard and Shields come from `extension/`. `tools/chromium/pack-extension.mjs` packs it as a
signed CRX3 file. The signing key fixes the extension's ID (`kceipbaiojomdibnboffoieecidpfdck`) and
comes from the `ORBIT_EXTENSION_KEY` secret. Losing the key means a new ID, and people would lose
the extension's saved data on the next update.

`tools/chromium/make-icons.ps1` regenerates `overlay/` logos and `mac-icons/` from `branding/`.
The builds run in `.github/workflows/browser-*.yml`.
