# Third-party notices

Orbit's own code is under the Mozilla Public License 2.0. It builds on the projects below.

## Chromium and its dependencies

Orbit is built from Chromium. The full list of Chromium's components and their licenses is in `CREDITS.html`, which ships with every Orbit package and appears at `chrome://credits` in the browser.

## Filter lists

Shields ships rules compiled from these lists. `filters/rules/meta.json` records the exact source, hash and license of each.

- EasyList and EasyPrivacy, by The EasyList authors (https://easylist.to/), used under CC BY-SA 3.0.
- Malicious URL Blocklist, by Ming Di Leom (https://gitlab.com/malware-filter/urlhaus-filter), CC0 1.0, from URLhaus data by abuse.ch. Not endorsed by abuse.ch.
- Phishing URL Blocklist, by Ming Di Leom (https://gitlab.com/malware-filter/phishing-filter), used under CC BY-SA 4.0, from OpenPhish, IPThreat and PhishTank data. Not endorsed by those sources.

## Fonts

Orbit's built-in pages use Readex Pro, copyright 2018 The Readex Pro Project Authors (https://github.com/ThomasJockin/readexpro), under the SIL Open Font License 1.1. The license is in `extension/src/shared/fonts/OFL.txt`.

## Background video

The new tab page's default background is "Black Hole Accretion Disk Visualization" from NASA's Scientific Visualization Studio (https://svs.gsfc.nasa.gov/13326/), credit NASA's Goddard Space Flight Center/Jeremy Schnittman. Under NASA's media usage guidelines, NASA content like this is generally not subject to copyright in the United States. Orbit ships it re-encoded (`extension/src/newtab/media/blackhole.webm`) with one frame as a still image (`blackhole.jpg`), and shows the credit on the page. NASA does not endorse Orbit.

## Weather

Weather data by Open-Meteo.com, under CC BY 4.0. It is requested only after a person enters a city.
