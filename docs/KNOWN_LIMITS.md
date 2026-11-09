# Known limits

These are true of the current code. Each one says what a person would notice.

## Release blockers

| Limit | What a person notices | Path to fix |
| --- | --- | --- |
| No H.264, AAC or HEVC | Sites that only offer those formats do not play, including many news and social video players. Twitch and Vimeo failed in testing. YouTube works through VP9 | A custom CEF build with proprietary codecs. It needs build capacity and a decision on patent licensing |
| No signed packages | Windows and macOS warn about an unknown publisher | Windows: SignPath's free open source signing. macOS: Developer ID signing and notarization, using the existing Apple membership |
| No updater | A person must install new versions by hand, and security fixes do not arrive by themselves | Sparkle on macOS and WinSparkle on Windows, both with EdDSA signatures. Linux through a package repository |
| Not tested on real hardware outside CI | macOS and Linux have only run on CI machines | Testing on real machines |

## Engine limits

These come from official CEF binaries, and also apply to unbranded Chromium.

- **Safe Browsing** does not work. Threat lists are a partial, slower replacement. Without it, Chromium holds program downloads such as .exe files and asks the person to confirm, because it cannot check them.
- **Key pinning** is off.
- **Certificate Transparency** data is on through a feature switch, and whether it is enforced is unproven.
- **Network Service sandbox on Windows** is off by default on both Chrome and CEF.
- **Widevine:** encrypted VP9 test streams play. H.264 Widevine does not. Commercial streaming services are untested.
- **Translation** is not available.

## Orbit limits

- **Blocking**
  - Leftover ad space is hidden by CSS only. Filters that need a script to evaluate them are skipped, and generic filters are limited to simple selectors. Site-specific hiding applies to the top page, not to frames inside it.
  - 3,137 EasyList filters use options with no exact equivalent in the rule engine, such as popup-only and content security policy filters, and are skipped.
  - Filters in regular expression form are skipped.
  - New rules only arrive with Orbit updates.
- **Guest windows** have no extensions, so no Shields.
- **Fingerprinting protection** runs in the page. It covers canvas, audio and graphics readings, not fonts or every other signal, and not canvases in web workers.
- **Protection counts** show ads, trackers and threats only. Tracking cookies blocked and bandwidth saved are not shown, because the browser reports no reliable number for them.
- **Session restore** brings back the most recent window only, even if several were open.
- **Crash detection** needs preferences on disk, which happens about 10 seconds after start. A crash sooner than that on a first run restores nothing.
- **Clearing data at startup** starts at the same moment as session restore, so a restored page might load first.
- **Settings pages:** rows for Safe Browsing, Safety Check, the Privacy Guide, sync and Google services are removed at build time. Those pages can still be reached by typing their address, and some Settings text elsewhere still mentions Google.
- **Address bar and settings icons** still use Chromium's swirl in a few places, because they are compiled into the engine.
- **Sign-in to the browser** is off. Google sites can still be used normally in a tab, though real Google login has not been tested.
- **macOS:** the menu bar and its shortcuts compile, and whether they work has not been checked on a real Mac.

## Not measured yet

Startup time, memory use, idle CPU and rendering performance. The brief requires repeatable benchmarks, and they are not written yet.
