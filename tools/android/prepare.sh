#!/bin/bash
# First stage only: fetches Chromium's toolchains and generates the Android build files.
set -euo pipefail

cd src
python3 tools/clang/scripts/update.py
python3 tools/rust/update_rust.py
python3 build/linux/sysroot_scripts/install-sysroot.py --arch=amd64
third_party/node/update_node_binaries > /dev/null 2>&1
third_party/node/linux/node-linux-x64/bin/node --version
test -f third_party/node/node_modules/typescript/lib/tsc.js
third_party/jdk/current/bin/java -version

mkdir -p out/gn
CC="$PWD/third_party/llvm-build/Release+Asserts/bin/clang" \
CXX="$PWD/third_party/llvm-build/Release+Asserts/bin/clang++" \
AR="$PWD/third_party/llvm-build/Release+Asserts/bin/llvm-ar" \
LDFLAGS="-fuse-ld=lld" \
  python3 tools/gn/bootstrap/bootstrap.py --skip-generate-buildfiles -j"$(nproc)" -o out/gn/gn

mkdir -p out/Release
../tools/android/args.sh out/Release/args.gn
out/gn/gn gen out/Release
out/gn/gn args out/Release --list=enable_extensions_core --short || true
ninja -C out/Release -n $TARGETS | tail -1
df -h .
