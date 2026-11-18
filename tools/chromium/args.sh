#!/bin/bash
# Writes Orbit's build settings (tools/chromium/args.gn) to the given file, leaving it untouched
# when nothing changed. Windows and macOS build with proprietary codecs: MP4 reading from Chromium's
# FFmpeg, H.264 and AAC decoding from the operating system (orbit-media.patch). OpenH264 stays out, so
# no H.264 encoder is compiled in; encoding also goes through the operating system.
#
# Official builds optimize with Chromium's published PGO profile for this system. The source
# archive does not carry it, so it is downloaded into chrome/build/pgo_profiles, where the build
# looks for the file named in chrome/build/<target>.pgo.txt.
#
# Windows builds without ThinLTO: Chromium sizes a ThinLTO link of chrome.dll at about 45 GB of
# memory, and the free Windows runner has 16 GB. PGO, the larger part of the gain, stays on.
set -euo pipefail
dest=$1
src=$(cd "$(dirname "$dest")/../.." && pwd)
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) target=win64; sed -e 's/^proprietary_codecs = false/proprietary_codecs = true/' -e 's/^use_thin_lto = true/use_thin_lto = false/' "$(dirname "$0")/args.gn" > "$dest.new" ;;
  Darwin) target=mac-arm; sed 's/^proprietary_codecs = false/proprietary_codecs = true/' "$(dirname "$0")/args.gn" > "$dest.new" ;;
  *) target=linux; cp "$(dirname "$0")/args.gn" "$dest.new" ;;
esac
if cmp -s "$dest.new" "$dest"; then rm "$dest.new"; else mv "$dest.new" "$dest"; fi

profile=$(tr -d '[:space:]' < "$src/chrome/build/$target.pgo.txt")
case "$profile" in
  chrome-*.profdata) ;;
  *) echo "Unexpected PGO profile name in chrome/build/$target.pgo.txt: $profile" >&2; exit 1 ;;
esac
mkdir -p "$src/chrome/build/pgo_profiles"
if [ ! -s "$src/chrome/build/pgo_profiles/$profile" ]; then
  curl -fsSL --retry 5 --retry-delay 10 -o "$src/chrome/build/pgo_profiles/$profile.part" \
    "https://storage.googleapis.com/chromium-optimization-profiles/pgo_profiles/$profile"
  mv "$src/chrome/build/pgo_profiles/$profile.part" "$src/chrome/build/pgo_profiles/$profile"
fi
# Every object depends on the profile, and each stage downloads it again: a fixed date keeps a
# restored build from compiling everything once more.
touch -t 202001010000 "$src/chrome/build/pgo_profiles/$profile"
echo "PGO profile: $profile ($(du -h "$src/chrome/build/pgo_profiles/$profile" | cut -f1))"
