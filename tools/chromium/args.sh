#!/bin/bash
# Writes Orbit's build settings for this platform (args-for.sh) to the given file, leaving it
# untouched when nothing changed.
#
# Builds with PGO optimize with Chromium's published profile for this system. The source archive
# does not carry it, so it is downloaded into chrome/build/pgo_profiles, where the build looks for
# the file named in chrome/build/<target>.pgo.txt.
set -euo pipefail
dest=$1
src=$(cd "$(dirname "$dest")/../.." && pwd)
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) platform=windows; target=win64 ;;
  Darwin) platform=mac; target=mac-arm ;;
  *) platform=linux; target=linux ;;
esac
"$(dirname "$0")/args-for.sh" "$platform" > "$dest.new"
if cmp -s "$dest.new" "$dest"; then rm "$dest.new"; else mv "$dest.new" "$dest"; fi

grep -qx 'chrome_pgo_phase = 2' "$dest" || exit 0
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
