#!/bin/bash
# Downloads Google's official Chromium source archive, checks its published hash and unpacks it.
set -euo pipefail

base="https://commondatastorage.googleapis.com/chromium-browser-official"
archive="chromium-${CHROMIUM_VERSION}-lite.tar.xz"
curl -fsSL --retry 5 -o "$archive" "$base/$archive"
expected=$(curl -fsSL --retry 5 "$base/$archive.hashes" | awk '$1 == "sha256" { print $2 }')
test -n "$expected"
echo "$expected  $archive" | shasum -a 256 -c -
mkdir src
tar -xf "$archive" -C src --strip-components=1
rm "$archive"
df -h .
