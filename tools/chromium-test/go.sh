#!/bin/bash
# Installs the Go version Dawn pins, from Go's official downloads. Dawn runs Go during the build.
set -euo pipefail

cd src/third_party/dawn
version=$(sed -n "s/^ *'dawn_go_version': 'version:[0-9]*@\([0-9.]*\)',.*/\1/p" DEPS)
test -n "$version"
archive="go${version}.linux-amd64.tar.gz"
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
echo "$expected  $archive" | sha256sum -c -
mkdir -p tools/golang/linux-amd64
tar -xzf "$archive" -C tools/golang/linux-amd64 --strip-components=1
rm "$archive"
tools/golang/linux-amd64/bin/go version
