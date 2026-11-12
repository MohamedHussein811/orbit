# Architecture

Orbit is a Chromium fork. Google's official Chromium source archive is unpacked on CI, Orbit's changes are applied on top, and the result is compiled for each system. Orbit keeps Chromium's sandbox, site isolation and security updates, and changes its source where the product needs it.

```text
Chromium 157 source archive (pinned version, verified)
        │
        ▼  tools/chromium/apply-fork.py
  chromium/overlay/   files copied over the tree (logos, palette, icons, extension target)
  chromium/patches/   source patches, applied in the order in series
  string renaming     Chromium and Chrome as the product name become Orbit
        │
        ▼  .github/workflows/chromium-stage.yml (chained stages, resumable)
  Orbit for Windows, macOS and Linux, with the built-in extension inside
```

## Components

| Component | Path | Responsibility |
| --- | --- | --- |
| Fork | `chromium/`, `tools/chromium/` | Overlay files, patches, string renaming, build stages, browser checks |
| Design system | `tools/design/`, `chromium/DESIGN.md` | Color tokens for the browser and pages, the logo, toolbar icons |
| Extension | `extension/` | New tab page, Shields counters and switches, privacy page, threat warning page |
| Filter pipeline | `tools/filter-compiler.mjs`, `tools/filters.mjs` | Turns filter lists into rules. Filters with no exact equivalent are skipped and counted |

## Data flow

- **Blocking:** Chromium evaluates rules before a request leaves the browser. No page address leaves the device for this.
- **Counts:** the rule engine reports each match to the extension's worker, which adds it to daily totals. It stores no address.
- **Preferences:** Orbit changes default values only, so a choice made in Settings still wins.
- **Weather:** after a person enters a city, the new tab page sends the city name to Open-Meteo's geocoder, then coordinates rounded to about 11 km to its forecast service. Nothing is sent before that.
- **Background:** the new tab page's video ships inside the browser. A person's own image or video stays on the device.

## Security boundaries

| Boundary | How it holds |
| --- | --- |
| Web page and browser process | Chromium's sandbox and site isolation, unchanged |
| Web page and extension | Pages cannot reach extension APIs. The extension has no externally connectable pages |
| Web page and internal pages | Unchanged from Chromium. `orbit://` exists only in the address bar: what a person types there, and how internal pages are shown |
