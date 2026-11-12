# Third-party notices

Orbit's own code is under the Mozilla Public License 2.0. It builds on the projects below.

## Chromium and its dependencies

Orbit runs Chromium through CEF. The full list of Chromium's components and their licenses is in `CREDITS.html`, which ships with every Orbit package and appears at `chrome://credits` in the browser.

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

## Chromium Embedded Framework

Orbit links against CEF. Parts of `host/src/main_win.cc`, `host/src/main_linux.cc`, `host/src/main_mac.mm`, `host/src/helper_mac.cc` and the property lists in `host/mac/` are derived from CEF's `cefsimple` sample, copyright (c) 2013 The Chromium Embedded Framework Authors.

CEF's license:

```text
Copyright (c) 2008-2020 Marshall A. Greenblatt. Portions Copyright (c)
2006-2009 Google Inc. All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are
met:

   * Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.
   * Redistributions in binary form must reproduce the above
copyright notice, this list of conditions and the following disclaimer
in the documentation and/or other materials provided with the
distribution.
   * Neither the name of Google Inc. nor the name Chromium Embedded
Framework nor the names of its contributors may be used to endorse
or promote products derived from this software without specific prior
written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```
