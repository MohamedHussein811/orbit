#!/bin/bash
# Packs the build output and downloaded toolchains. The source itself comes from the archive again.
set -euo pipefail

cd src
paths=(out third_party/llvm-build third_party/rust-toolchain)
for extra in build/linux/debian_bullseye_amd64-sysroot build/linux/debian_bookworm_amd64-sysroot third_party/node/linux; do
  if [ -e "$extra" ]; then paths+=("$extra"); fi
done
tar -cf - "${paths[@]}" | zstd -T0 -3 -o ../state.tar.zst
ls -lh ../state.tar.zst
