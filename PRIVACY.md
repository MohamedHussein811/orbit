# Orbit privacy policy

Orbit has no accounts, ads, analytics, crash reports or telemetry. NovaTech runs no servers for
Orbit and receives nothing from it. This page lists every connection Orbit makes on its own, that
is, without a person asking for a page. Everything else Orbit sends goes to the sites a person
visits, the search engine they use (DuckDuckGo by default) and their secure DNS provider (Quad9 by
default), all of which can be changed in Settings.

## Connections Orbit makes on its own

| What | Where it goes | What it sends | How to turn it off |
| --- | --- | --- | --- |
| Browser updates (Windows) | GitHub Releases of the Orbit project | A plain download request every few hours, with no cookies or identifiers. GitHub sees the device's IP address | Clear "Keep Orbit up to date automatically" in Orbit's setup |
| Built-in extension updates (Shields rules) | GitHub Releases of the Orbit project | A daily update check for the extension, as Chromium does for any extension with an update address | Not available; it carries the blocking rules |
| New release note on the new tab page | GitHub Releases of the Orbit project | A daily download of a small file that names the newest version | "Orbit updates" on Orbit's privacy page |
| Early connection to the search engine | The search engine a search in the address bar would go to | While a search is typed, at most once every eight seconds, a connection is opened (DNS, TCP, TLS) so the results load sooner. Nothing typed is sent before Enter; the search engine sees the IP address a little earlier | Not available in Settings |
| Engine components | Google (`update.googleapis.com`, `edgedl.me.gvt1.com`) | Chromium's component update check, which names the installed component versions. It carries certificate revocation data and the Widevine decoder for protected video | Not available in Settings |

Linux packages are updated by the system's package manager from Orbit's package list on GitHub
Releases, which the package adds when installed.

## Connections after a person turns something on

| What | Where it goes | What it sends |
| --- | --- | --- |
| Weather on the new tab page | Open-Meteo | The city name the person enters, then coordinates rounded to about 11 km |
| Orbit Gallery | Pixabay's servers (cdn.pixabay.com) | Requests for the chosen video, its still frame and the small previews, without cookies |
| Shortcut icons on the new tab page | Each shortcut's own site | A request for the site's icon, without cookies or a referrer, once per shortcut |

A person's own background image or video, notes, shortcuts, history and settings stay on the
device.

## What stays off

Sign-in and sync, Safe Browsing lookups, search and page prediction, translation, the browser's
AI features, and the advertising web APIs (Topics, Protected Audience, Attribution Reporting) are
off by default. Details are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## Orbit on phones

The Android and iPhone apps follow the same rules: no accounts, ads, analytics, crash reports or
telemetry, and nothing is sent to NovaTech. They are published in Google Play and the App Store by
Runovate LLC.

- **Android** uses the same Chromium engine and defaults as the desktop browser, so the tables
  above apply, except the Windows updater. Installs from Google Play are updated by Google Play;
  an APK downloaded from GitHub Releases does not update by itself.
- **iPhone** uses Apple's WebKit, as Apple requires. The app makes no connections on its own: its
  blocking lists ship inside the app, and bookmarks, history and settings stay on the device.
  Updates come from the App Store.

## Contact

Questions go to the project's [issues](https://github.com/MohamedHussein811/orbit/issues).
Security reports follow [SECURITY.md](SECURITY.md).
