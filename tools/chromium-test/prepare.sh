#!/bin/bash
# First stage only: fetches Chromium's toolchains and generates the build files.
set -euo pipefail

tools/chromium-test/packages.sh
cd src

sudo build/install-build-deps.sh --no-prompt --no-arm --no-chromeos-fonts --no-nacl > /dev/null
python3 tools/clang/scripts/update.py
python3 tools/rust/update_rust.py
python3 build/linux/sysroot_scripts/install-sysroot.py --arch=amd64
if [ -x third_party/node/update_node_binaries ]; then third_party/node/update_node_binaries; fi

export CC="$PWD/third_party/llvm-build/Release+Asserts/bin/clang"
export CXX="$PWD/third_party/llvm-build/Release+Asserts/bin/clang++"
export AR="$PWD/third_party/llvm-build/Release+Asserts/bin/llvm-ar"
export LDFLAGS="-fuse-ld=lld"
python3 tools/gn/bootstrap/bootstrap.py --skip-generate-buildfiles -j"$(nproc)" -o out/gn/gn
unset CC CXX AR LDFLAGS

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
ninja -C out/Release -n chrome chrome_sandbox | tail -1
df -h /
