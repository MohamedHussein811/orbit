#!/bin/bash
# Downloads Google's official Chromium source archive, checks its published hash and unpacks it.
set -euo pipefail
is_windows() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; esac; return 1; }

base="https://commondatastorage.googleapis.com/chromium-browser-official"
archive="chromium-${CHROMIUM_VERSION}-lite.tar.xz"
curl -fsSL --retry 5 -o "$archive" "$base/$archive"
expected=$(curl -fsSL --retry 5 "$base/$archive.hashes" | awk '$1 == "sha256" { print $2 }')
test -n "$expected"
if command -v sha256sum > /dev/null; then
  echo "$expected  $archive" | sha256sum -c -
else
  echo "$expected  $archive" | shasum -a 256 -c -
fi
if is_windows; then
  # 7-Zip is much faster than tar on Windows. It may warn about Linux symbolic links it cannot make.
  7z x "$archive" -so | 7z x -si -ttar -bd -aoa -ounpacked > unpack.log 2>&1 || tail -20 unpack.log
  mv "unpacked/chromium-$CHROMIUM_VERSION" src
  rm -rf unpacked
  test -f src/DEPS && test -f src/chrome/BUILD.gn
else
  mkdir src
  tar -xf "$archive" -C src --strip-components=1
fi
rm "$archive"
df -h .
