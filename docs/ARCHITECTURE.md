# Architecture

Orbit is Chromium's own tabbed browser, opened through the Chromium Embedded Framework (CEF), with a thin native host and one built-in extension. Orbit does not draw the tabs, address bar or settings. Chromium does.

```text
┌─────────────────────────────────────────────────────────────┐
│ Chromium browser UI (tabs, address bar, settings, downloads)│
│ Provided by official CEF binaries, pinned by SHA-256         │
└───────────────▲─────────────────────────────▲───────────────┘
                │ CEF client API              │ --load-extension
┌───────────────┴───────────────┐  ┌──────────┴────────────────┐
│ Native host (host/)           │  │ Built-in extension        │
│ Window creation, startup,     │  │ (extension/)              │
│ defaults, session restore,    │◄─┤ Dashboard, Shields,       │
│ command removal               │  │ privacy page              │
└───────────────────────────────┘  └──────────┬────────────────┘
    host API: requests to                     │ declarativeNetRequest
    https://orbit.invalid/                    ▼
    answered in-process            ┌───────────────────────────┐
                                   │ Chromium's rule engine     │
                                   │ Rules: filters/rules/      │
                                   └───────────────────────────┘
```

## Components

| Component | Path | Responsibility |
| --- | --- | --- |
| Engine pin | `engine/engine.json` | Exact CEF version and hashes for each platform |
| Native host | `host/` | The only code that names CEF. Starts the browser and applies defaults |
| Extension | `extension/` | Dashboard, Shields counters and switches, privacy page, threat warning page |
| Filter pipeline | `tools/filter-compiler.mjs`, `tools/filters.mjs` | Turns filter lists into rules. Filters with no exact equivalent are skipped and counted |
| Branding | `tools/brand.mjs`, `host/tools/stamp_exe.cc` | Rewrites engine resource packs and executable resources at build time |
| Packaging | `tools/package.mjs`, `packaging/` | Installers and archives for each system |

## Why CEF

Compiling Chromium needs far more memory than the development machine has, and a maintained fork needs paid build capacity. CEF's official binaries give a real Chromium browser with its sandbox and site isolation, and they follow Chromium's stable releases within days. The full evaluation, with measurements, is in the feasibility report.

The cost is control. Orbit can change preferences, switches, resources and extension APIs, but not Chromium's source. Limits that follow from this are in [KNOWN_LIMITS.md](KNOWN_LIMITS.md).

## Keeping CEF replaceable

Only `host/` names CEF. The extension, filter pipeline, branding packs and tests talk to Chromium, not to CEF. A maintained Chromium fork could replace the host and keep the rest, except the small host API described below.

## Data flow

- **Blocking:** Chromium evaluates rules before a request leaves the browser. No page address leaves the device for this.
- **Counts:** the rule engine reports each match to the extension's worker, which adds it to daily totals. It stores no address.
- **Preferences:** applied once per profile, so a person's later changes stay.
- **Weather:** after a person enters a city, the dashboard sends the city name to Open-Meteo's geocoder, then coordinates rounded to about 11 km to its forecast service. Nothing is sent before that.
- **Engine updates:** the engine's component updater contacts Google for CRLSet, certificate data and Widevine. This cannot be split by component without a custom build.

## Security boundaries

| Boundary | How it holds |
| --- | --- |
| Web page and browser process | Chromium's sandbox and site isolation, unchanged. Tests check them on each system |
| Web page and extension | Pages cannot reach extension APIs. The extension has no externally connectable pages |
| Extension and host | Host API requests are accepted only when the browser process reports the extension's origin as the initiator. Websites get a network error, which a test checks |
| Fingerprint script and page | Runs in the page's world, so it holds no secret and no extension API |
| Test build and real profiles | `orbit_test` refuses to start without `ORBIT_USER_DATA_DIR`. The release build ignores command-line switches |

## Startup

1. `RunWinMain` or `main` resolves the profile folder and reads the saved startup choice from disk.
2. CEF starts. `OnContextInitialized` applies defaults once per profile.
3. The first window opens. If the setting or a crash calls for it, `IDC_RESTORE_TAB` restores the last window, guarded against crash loops.
4. Chromium loads the extension, whose worker applies privacy choices once per session.
