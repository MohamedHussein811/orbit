#!/bin/bash
# Writes Orbit's Android build settings to the given file, with target_cpu from ANDROID_CPU
# (default arm64), leaving the file untouched when nothing changed.
#
# Play needs a higher versionCode for every upload. Chromium's own code leaves out the version's
# second part, which holds Orbit's release number, so the code is set here as
# {BUILD}{PATCH, 3 digits}{release, 2 digits}: 157.5.8103.78 gives 810307805.
set -euo pipefail
dest=$1
src=$(cd "$(dirname "$dest")/../.." && pwd)
cpu=${ANDROID_CPU:-arm64}
version() { sed -n "s/^$1=\([0-9]*\)$/\1/p" "$src/chrome/VERSION"; }
release=$(version MINOR)
code=$(( $(version BUILD) * 100000 + $(version PATCH) * 100 + release % 100 ))
{
  sed "s/^target_cpu = .*/target_cpu = \"$cpu\"/" "$(dirname "$0")/args.gn"
  echo "android_override_version_code = \"$code\""
} > "$dest.new"
if cmp -s "$dest.new" "$dest"; then rm "$dest.new"; else mv "$dest.new" "$dest"; fi
echo "versionCode $code"
