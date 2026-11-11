#!/bin/bash
# Installs the Go version Dawn pins, from Go's official downloads. Dawn runs Go during the build.
set -euo pipefail

case "$(uname -s)" in
  MINGW*|MSYS*)
    # On Windows, fetch-deps.py --windows-extras already fetched Dawn's pinned Go package.
    src/third_party/dawn/tools/golang/windows-amd64/bin/go.exe version
    exit 0 ;;
esac

if [ "$(uname)" = "Darwin" ]; then
  folder=mac-arm64
  platform=darwin-arm64
else
  folder=linux-amd64
  platform=linux-amd64
fi

cd src/third_party/dawn
version=$(sed -n "s/^ *'dawn_go_version': 'version:[0-9]*@\([0-9.]*\)',.*/\1/p" DEPS)
test -n "$version"
archive="go${version}.${platform}.tar.gz"
expected=$(curl -fsSL --retry 5 "https://go.dev/dl/?mode=json&include=all" | python3 -I -c '
import json, sys
name = sys.argv[1]
for release in json.load(sys.stdin):
    for item in release["files"]:
        if item["filename"] == name:
            print(item["sha256"])
' "$archive")
test -n "$expected"
curl -fsSL --retry 5 -o "$archive" "https://go.dev/dl/$archive"
echo "$expected  $archive" | shasum -a 256 -c -
mkdir -p "tools/golang/$folder"
tar -xzf "$archive" -C "tools/golang/$folder" --strip-components=1
rm "$archive"
"tools/golang/$folder/bin/go" version
