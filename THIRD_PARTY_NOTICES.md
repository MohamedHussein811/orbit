# Third-party notices

Orbit's own code is under the Mozilla Public License 2.0. It builds on the projects below.

## Chromium and its dependencies

Orbit is built from Chromium. The full list of Chromium's components and their licenses is in `CREDITS.html`, which ships with every Orbit package and appears at `chrome://credits` in the browser.

## Filter lists

Shields ships rules compiled from these lists. `filters/rules/meta.json` records the exact source, hash and license of each.

- EasyList and EasyPrivacy, by The EasyList authors (https://easylist.to/), used under CC BY-SA 3.0.
- Liste AR, by the Liste AR authors (https://code.google.com/p/liste-ar-adblock/), used under CC BY-SA 3.0.
- Malicious URL Blocklist, by Ming Di Leom (https://gitlab.com/malware-filter/urlhaus-filter), CC0 1.0, from URLhaus data by abuse.ch. Not endorsed by abuse.ch.
- Phishing URL Blocklist, by Ming Di Leom (https://gitlab.com/malware-filter/phishing-filter), used under CC BY-SA 4.0, from OpenPhish, IPThreat and PhishTank data. Not endorsed by those sources.

## Fonts

Orbit's built-in pages use Readex Pro, copyright 2018 The Readex Pro Project Authors (https://github.com/ThomasJockin/readexpro), under the SIL Open Font License 1.1. The license is in `extension/src/shared/fonts/OFL.txt`.

## Background videos

The new tab page's default background is a black hole video from Pixabay (https://pixabay.com/videos/space-universe-astronomy-cosmos-175323/), used under the Pixabay Content License (https://pixabay.com/service/license-summary/). Orbit ships it re-encoded to play forward and back as a seamless loop (`extension/src/newtab/media/space.webm`), with its first frame as a still image (`space.jpg`).

Orbit Gallery's Space category also ships "Black Hole Accretion Disk Visualization" from NASA's Scientific Visualization Studio (https://svs.gsfc.nasa.gov/13326/), credit NASA's Goddard Space Flight Center/Jeremy Schnittman. Under NASA's media usage guidelines, NASA content like this is generally not subject to copyright in the United States. Orbit ships it re-encoded (`extension/src/newtab/media/blackhole.webm`) with one frame as a still image (`blackhole.jpg`), and shows the credit on the page. NASA does not endorse Orbit.

The other Orbit Gallery videos are not shipped: `extension/src/newtab/gallery.json` lists files on Wikimedia Commons (public domain, CC0, CC BY or CC BY-SA), and the page downloads the one shown, with its author and license in the credit line, linking to the file's Commons page.

## Weather

Weather data by Open-Meteo.com, under CC BY 4.0. It is requested only after a person enters a city.
