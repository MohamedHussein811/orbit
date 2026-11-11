#!/bin/bash
# Downloads one public package from Chromium's package server into a folder.
# Usage: cipd.sh <package> <version> <folder>
set -euo pipefail

package=$1
version=$2
folder=$3
encoded=$(python3 -I -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$version")
archive=$(mktemp)
curl -fsSL --retry 5 -o "$archive" "https://chrome-infra-packages.appspot.com/dl/$package/+/$encoded"
echo "$package $version sha256 $(shasum -a 256 "$archive" | cut -d' ' -f1)"
rm -rf "$folder"
mkdir -p "$folder"
unzip -q "$archive" -d "$folder"
rm "$archive"
