# Known limits

These are true of the current code. Each one says what a person would notice.

## Release blockers

| Limit | What a person notices | Path to fix |
| --- | --- | --- |
| No H.264 or AAC on Linux | On Windows and macOS, H.264 and AAC play through the operating system (on Windows, H.264 needs hardware decoding). On Linux, sites that only offer those formats do not play. YouTube works everywhere through VP9 | Licensed decoders (option C in [VIDEO.md](VIDEO.md)) |
| Windows installer not code-signed | Windows SmartScreen warns about an unknown publisher on first run. The macOS disk image is signed and notarized only once the signing secrets are set | Windows: SignPath's free open source signing. macOS: the secrets listed in [RELEASING.md](RELEASING.md) |
| Browser does not update in place | Orbit shows a note on the new tab page when a newer release is out, but people install it themselves. Shields rules do update automatically | Chromium's own updater, or signed update feeds for each system |
| Not tested on real hardware outside CI | macOS and Linux have only run on CI machines | Testing on real machines |

## Engine limits

These also apply to unbranded Chromium builds.

- **Safe Browsing** does not work. Threat lists are a partial, slower replacement. Without it, Chromium holds program downloads such as .exe files and asks the person to confirm, because it cannot check them.
- **Key pinning** is off.
- **Certificate Transparency** data is on through a feature switch, and whether it is enforced is unproven.
- **Network Service sandbox on Windows** is off by default, as in Chrome.
- **Widevine:** encrypted VP9 test streams play. H.264 Widevine does not. Commercial streaming services are untested.
- **Translation** is not available.

## Orbit limits

- **Blocking**
  - Leftover ad space is hidden by CSS only. Filters that need a script to evaluate them are skipped, and generic filters are limited to simple selectors. Site-specific hiding applies to the top page, not to frames inside it.
  - 3,137 EasyList filters use options with no exact equivalent in the rule engine, such as popup-only and content security policy filters, and are skipped.
  - Filters in regular expression form are skipped.
  - New rules arrive with each release, through the built-in extension's own update feed.
- **Guest windows** have no extensions, so no Shields.
- **Fingerprinting protection** runs in the page. It covers canvas, audio and graphics readings, not fonts or every other signal, and not canvases in web workers.
- **Protection counts** show ads, trackers and threats only. Tracking cookies blocked and bandwidth saved are not shown, because the browser reports no reliable number for them.
- **Settings pages:** rows for Safe Browsing, Safety Check, the Privacy Guide, sync and Google services are removed at build time. Those pages can still be reached by typing their address, and some Settings text elsewhere still mentions Google.
- **Default browser:** the Windows installer registers Orbit so Windows can offer it in Default apps. Settings has a "Make default" button whose effect has not been tested, and it may not detect that Orbit is the default.
- **Sign-in to the browser** is off. Google sites can still be used normally in a tab, though real Google login has not been tested.
- **macOS and Linux** have only run on CI machines, not on physical computers.
- **macOS full screen** shows the tabs in macOS's full screen title bar above the toolbar, as Chrome does, instead of Orbit's single row. Changing it means leaving Chromium's tabbed full screen mode, which needs testing on a real Mac.

## Not measured yet

Startup time, memory use, idle CPU and rendering performance. The brief requires repeatable benchmarks, and they are not written yet.
