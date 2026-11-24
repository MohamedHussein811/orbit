# Third-party notices

Orbit's own code is under the Mozilla Public License 2.0. It builds on the projects below.

## Chromium and its dependencies

Orbit is built from Chromium. The full list of Chromium's components and their licenses is in `CREDITS.html`, which ships with every Orbit package and appears at `chrome://credits` in the browser.

## Filter lists

Shields ships rules compiled from these lists. `filters/rules/meta.json` records the exact source, hash and license of each.

- EasyList and EasyPrivacy, by The EasyList authors (https://easylist.to/), used under CC BY-SA 3.0.
- Liste AR, by the Liste AR authors (https://code.google.com/p/liste-ar-adblock/), used under CC BY-SA 3.0.
- uBlock filters, with Badware risks, Privacy, Quick fixes and Unbreak, by the uBlock Origin filter list authors (https://github.com/uBlockOrigin/uAssets), used under the GNU General Public License 3.0. The lists' source is that repository; `filters/rules/meta.json` records the hash of each copy Orbit compiled. The scriptlets these lists name run through Orbit's own implementations (`extension/src/sites/scriptlets.ts`), not uBlock Origin's code.
- uBlock Origin's resource files (`filters/rules/resources`), by Raymond Hill and the uBlock Origin contributors (https://github.com/gorhill/uBlock), used unchanged under the GNU General Public License 3.0. They are the harmless stand-ins that redirect filters load in place of blocked files; `filters/sources.json` names the commit they come from.
- Malicious URL Blocklist, by Ming Di Leom (https://gitlab.com/malware-filter/urlhaus-filter), CC0 1.0, from URLhaus data by abuse.ch. Not endorsed by abuse.ch.
- Phishing URL Blocklist, by Ming Di Leom (https://gitlab.com/malware-filter/phishing-filter), used under CC BY-SA 4.0, from OpenPhish, IPThreat and PhishTank data. Not endorsed by those sources.

## Fonts

Orbit's built-in pages use Readex Pro, copyright 2018 The Readex Pro Project Authors (https://github.com/ThomasJockin/readexpro), under the SIL Open Font License 1.1. The license is in `extension/src/shared/fonts/OFL.txt`.

## Shortcut icons

The icons of the default shortcuts on the new tab page (`extension/src/newtab/sites/`) are drawn from Simple Icons (https://simpleicons.org/), released under CC0 1.0. The brands they show belong to their owners, who do not endorse Orbit.

## Background videos

The new tab page's default background is a black hole video from Pixabay (https://pixabay.com/videos/space-universe-astronomy-cosmos-175323/), used under the Pixabay Content License (https://pixabay.com/service/license-summary/). Orbit ships it re-encoded to play forward and back as a seamless loop (`extension/src/newtab/media/space.webm`), with its first frame as a still image (`space.jpg`).

Orbit Gallery's Space category also ships "Black Hole Accretion Disk Visualization" from NASA's Scientific Visualization Studio (https://svs.gsfc.nasa.gov/13326/), credit NASA's Goddard Space Flight Center/Jeremy Schnittman. Under NASA's media usage guidelines, NASA content like this is generally not subject to copyright in the United States. Orbit ships it re-encoded (`extension/src/newtab/media/blackhole.webm`) with one frame as a still image (`blackhole.jpg`), and shows the credit on the page. NASA does not endorse Orbit.

The other Orbit Gallery videos are not shipped: `extension/src/newtab/gallery.json` lists HD videos on Pixabay under the Pixabay Content License, and the page downloads the one shown from Pixabay's servers, crediting its author with a link to the video's Pixabay page.

## Weather

Weather data by Open-Meteo.com, under CC BY 4.0. It is requested only after a person enters a city.
