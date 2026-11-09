#!/bin/bash
# First stage only: fetches Chromium's toolchains and generates the build files.
set -euo pipefail

cd src

python3 tools/clang/scripts/update.py
python3 tools/rust/update_rust.py
node_version=$(sed -n 's/^NODE_VERSION="\(v[0-9.]*\)"/\1/p' third_party/node/update_node_binaries)
test -n "$node_version"

if [ "$(uname)" = "Darwin" ]; then
  # Same Node release that Chromium's own update script fetches, unpacked where node.py looks.
  name="node-${node_version}-darwin-arm64"
  curl -fsSL --retry 5 -o "$name.tar.gz" "https://nodejs.org/dist/$node_version/$name.tar.gz"
  curl -fsSL --retry 5 "https://nodejs.org/dist/$node_version/SHASUMS256.txt" | grep " $name.tar.gz\$" | shasum -a 256 -c -
  mkdir -p third_party/node/mac_arm64
  tar -xzf "$name.tar.gz" -C third_party/node/mac_arm64
  rm "$name.tar.gz"
  rm -rf third_party/node/mac_arm64/node-darwin-arm64
  mv "third_party/node/mac_arm64/$name" third_party/node/mac_arm64/node-darwin-arm64
  third_party/node/mac_arm64/node-darwin-arm64/bin/node --version
else
  python3 build/linux/sysroot_scripts/install-sysroot.py --arch=amd64
  third_party/node/update_node_binaries > /dev/null 2>&1
  third_party/node/linux/node-linux-x64/bin/node --version
  mkdir -p third_party/jdk/current/bin
  ln -sf "$(command -v java)" third_party/jdk/current/bin/java
fi
test -f third_party/node/node_modules/typescript/lib/tsc.js

mkdir -p out/gn
if [ "$(uname)" = "Darwin" ]; then
  python3 tools/gn/bootstrap/bootstrap.py --skip-generate-buildfiles -j"$(sysctl -n hw.ncpu)" -o out/gn/gn
else
  CC="$PWD/third_party/llvm-build/Release+Asserts/bin/clang" \
  CXX="$PWD/third_party/llvm-build/Release+Asserts/bin/clang++" \
  AR="$PWD/third_party/llvm-build/Release+Asserts/bin/llvm-ar" \
  LDFLAGS="-fuse-ld=lld" \
    python3 tools/gn/bootstrap/bootstrap.py --skip-generate-buildfiles -j"$(nproc)" -o out/gn/gn
fi

mkdir -p out/Release
cat > out/Release/args.gn <<'EOF'
is_debug = false
is_official_build = false
is_component_build = false
symbol_level = 0
blink_symbol_level = 0
v8_symbol_level = 0
treat_warnings_as_errors = false
use_thin_lto = false
is_cfi = false
chrome_pgo_phase = 0
proprietary_codecs = false
ffmpeg_branding = "Chromium"
use_remoteexec = false
use_siso = false
EOF
out/gn/gn gen out/Release
ninja -C out/Release -n $TARGETS | tail -1
df -h .
