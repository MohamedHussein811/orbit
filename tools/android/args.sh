#!/bin/bash
# Writes Orbit's Android build settings to the given file, with target_cpu from ANDROID_CPU
# (default arm64), leaving the file untouched when nothing changed.
set -euo pipefail
dest=$1
cpu=${ANDROID_CPU:-arm64}
sed "s/^target_cpu = .*/target_cpu = \"$cpu\"/" "$(dirname "$0")/args.gn" > "$dest.new"
if cmp -s "$dest.new" "$dest"; then rm "$dest.new"; else mv "$dest.new" "$dest"; fi
