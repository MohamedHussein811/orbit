#!/bin/bash
# Packs the build output and downloaded toolchains. The source itself comes from the archive again.
set -euo pipefail
shopt -s nullglob

cd src
paths=(out third_party/llvm-build third_party/rust-toolchain)
for extra in third_party/node/linux third_party/node/mac_arm64 third_party/jdk/current build/linux/*-sysroot; do
  if [ -e "$extra" ]; then paths+=("$extra"); fi
done
tar -cf - "${paths[@]}" | zstd -T0 -3 -o ../state.tar.zst
ls -lh ../state.tar.zst
echo "State saved: $(du -h ../state.tar.zst | cut -f1)" >> "$GITHUB_STEP_SUMMARY"
