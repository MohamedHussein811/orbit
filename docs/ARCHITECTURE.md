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
- **Counts:** the rule engine reports each match to the extension's worker, which adds it to daily totals. For each open tab it also keeps the blocked hosts in memory, for the Shields panel's list, until the tab navigates or closes. Full addresses are never kept.
- **Preferences:** Orbit changes default values only, so a choice made in Settings still wins.
- **Weather:** after a person enters a city, the new tab page sends the city name to Open-Meteo's geocoder, then coordinates rounded to about 11 km to its forecast service. Nothing is sent before that.
- **Background:** the new tab page's video ships inside the browser. A person's own image or video stays on the device.
- **Shortcut icons:** for each shortcut on the new tab page, the page asks that shortcut's own site once for its large icon (its home page, then the icon file), without cookies or a referrer, and stores the icon. Retries wait 14 days. An image the person chooses stays on the device.
- **Orbit Gallery:** the list of videos ships with the browser. When a person picks the gallery, the page downloads the chosen video and its still frame (and the small previews in Customize) from Wikimedia's servers, without cookies, and keeps the current one on the device. A new daily video downloads once a day; "Static picture" downloads only the still frame.
- **Pop-ups:** a tab a page opens is checked against a list that ships with the browser, and a tab opened behind the current one is closed unless the person asked for it. A small script on web pages tells the extension's worker only that a middle click, Ctrl or Cmd click, or link menu happened, nothing about the page or the link. Nothing is sent anywhere.
- **Updates:** on Windows, the browser fetches Orbit's signed release feed from GitHub every few hours without cookies, and downloads and runs a newer setup after checking it. On Linux, apt does this from Orbit's signed package list. Setup's automatic updates choice turns the Windows check off. [RELEASING.md](RELEASING.md) has the details.
- **Search engine:** the new tab page's "Search with" choice sets the browser's own default search engine through `chrome.search.setDefault`, which only Orbit's built-in extension may call (`orbit-search.patch`).
- **Import:** the import dialog reads bookmarks and history files of other browsers on the same device, in Chromium's import process, and writes them to the profile (`orbit-import.patch`). Nothing is sent anywhere.
- **Frequently visited sites:** when a person picks this for the new tab page, the list comes from the browser's own history and stays on the device.

## Security boundaries

| Boundary | How it holds |
| --- | --- |
| Web page and browser process | Chromium's sandbox and site isolation, unchanged |
| Web page and extension | Pages cannot reach extension APIs. The extension has no externally connectable pages |
| Web page and internal pages | Unchanged from Chromium. `orbit://` exists only in the address bar: what a person types there, and how internal pages are shown |
