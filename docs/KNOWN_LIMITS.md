# Known limits

These are true of the current code. Each one says what a person would notice.

## Release blockers

| Limit | What a person notices | Path to fix |
| --- | --- | --- |
| No H.264 or AAC on Linux | On Windows and macOS, H.264 and AAC play through the operating system (on Windows, H.264 needs hardware decoding). On Linux, sites that only offer those formats do not play. YouTube works everywhere through VP9 | Licensed decoders (option C in [VIDEO.md](VIDEO.md)) |
| Windows setup not code-signed yet | Windows SmartScreen warns about an unknown publisher on first run. SignPath Foundation declined Orbit in November 2026 because the project is new. The release workflow signs as soon as a certificate is set up. The macOS disk image is signed and notarized | A code signing certificate (see [RELEASING.md](RELEASING.md)), or SignPath again once Orbit is better known |
| macOS does not update by itself | Windows and Linux (.deb) copies update automatically. On macOS, Orbit shows a note on the new tab page when a newer release is out, and people install it themselves. The Linux archive (.tar.xz) does not update either | A signed self-update for macOS |
| Not tested on real hardware outside CI | macOS and Linux have only run on CI machines | Testing on real machines |

## Engine limits

These also apply to unbranded Chromium builds.

- **Google Safe Browsing** does not work. Orbit's own Safe Browsing choice (Settings > Privacy and security > Security, which opens Orbit's privacy page) turns Shields' threat lists on or off; they are a partial, slower replacement. Without it, Chromium holds program downloads such as .exe files and asks the person to confirm, because it cannot check them.
- **Key pinning** is off.
- **Certificate Transparency** data is on through a feature switch, and whether it is enforced is unproven.
- **Network Service sandbox on Windows** is off by default, as in Chrome.
- **Widevine:** encrypted VP9 test streams play. H.264 Widevine does not. Commercial streaming services are untested.
- **Translation** is not available.

## Orbit limits

- **Blocking**
  - Leftover ad space is hidden by CSS only. About 12,000 site filters that need a script to find the element (such as `:has-text` or `:upward`) are skipped; `:style()` and `:remove()` filters are applied as CSS. Generic filters are limited to simple selectors. Site-specific hiding applies to the top page, not to frames inside it. Sites the lists exempt from generic hiding (`$generichide`, `#@#`) get none.
  - Shields uses EasyList, EasyPrivacy, Liste AR and the uBlock Origin lists (uBlock filters, Badware risks, Privacy, Quick fixes, Unbreak). Redirect filters load a harmless stand-in (from uBlock Origin's resources) in place of a blocked ad script, so pages that check for the script keep working. About 5,250 filters use options with no exact equivalent in the rule engine, such as content security policy and header filters, and are skipped as rules. Pop-up filters are applied differently: a new tab a page opens is closed when it goes to a host the lists name as a pop-up or ad server. A tab a page opens behind the current one (a pop-under) is also closed when it goes to another site, unless the person opened it with a middle click, Ctrl or Cmd click, or the link menu. Pop-ups that open in front to unlisted hosts, and ads or fake sign-in boxes drawn over a video by the page itself, can still appear.
  - Filters in regular expression form become rules when Chromium's regex engine (RE2) reads them the same way; about 50 that use lookahead or backreferences are skipped. Where the uBlock lists offer a lookahead-free version, that one is used.
  - Scriptlets (`site##+js(...)`) run through Orbit's own implementations of the 37 most used ones, which cover about 96 in 100 of the lists' scriptlet filters. The rest are skipped.
  - With Shields off for a site, players and other frames it embeds from other sites still get the generic hiding rules and their own scriptlets. YouTube takes no list scriptlets, since Orbit's own YouTube script handles it.
  - New rules arrive with each release, through the built-in extension's own update feed.
  - YouTube ads are removed by a page script that strips the ad entries from YouTube's player data. Tested on two videos on 2026-11-14: the ad entries were gone and the videos played. YouTube changes often, and ads stitched into the video stream itself cannot be removed this way.
- **Guest windows** have no extensions, so no Shields.
- **After an update,** Orbit's new tab page, Shields and other built-in pages keep the previous version until the browser is restarted once more. Chromium waits to replace a built-in extension while its pages are open.
- **Fingerprinting protection** runs in the page. It covers canvas, audio and graphics readings, not fonts or every other signal, and not canvases in web workers.
- **Protection counts** show ads, trackers and threats only. Tracking cookies blocked and bandwidth saved are not shown, because the browser reports no reliable number for them.
- **Settings pages:** rows for Google Safe Browsing, Safety Check, the Privacy Guide, sync, Google services, Google Translate, Google Wallet, the Google Account, the Advanced Protection Program and live caption translation are removed at build time, as are the Gemini and AI mode site searches. Those pages can still be reached by typing their address (for example orbit://settings/googleServices, orbit://policy, orbit://feedback), and the site data option "clear on exit" still mentions keeping a Google Account signed in.
- **Default browser:** the Windows installer registers Orbit so Windows can offer it in Default apps. Settings > Get Started has a "Make default" button whose effect has not been tested, and it may not detect that Orbit is the default. The Pin to taskbar row appears only when Windows lets Orbit ask to be pinned; whether Windows allows that for Orbit is not known.
- **Sign-in to the browser** is off. Google sites can still be used normally in a tab, though real Google login has not been tested.
- **macOS and Linux** have only run on CI machines, not on physical computers.
- **Android:** if Orbit's built-in extension is turned off, new tabs show an empty page in the colour of Orbit's page instead of Chromium's. Strings meant for device administrators (managed configuration of the app) still say Chrome, and in some languages a translation names Chrome where the English text does not. The app is tested on phone and tablet emulators and by the owner on one phone.
- **iPhone:** Shields cannot show how many items it blocked, because Safari's content blocking does not report them. Generic hiding exceptions and scriptlets from the filter lists are not used on iPhone yet.
- **macOS full screen** shows the tabs in macOS's full screen title bar above the toolbar, as Chrome does, and hides Orbit's rail.

## Not measured yet

Startup time, memory use, idle CPU and rendering performance. The brief requires repeatable benchmarks, and they are not written yet.
