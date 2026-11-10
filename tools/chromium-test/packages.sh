#!/bin/bash
# System packages and host tools. Every stage starts on a fresh machine, so each one installs them.
set -euo pipefail
is_windows() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; esac; return 1; }

if [ "$(uname)" = "Darwin" ]; then
  brew install --quiet ninja zstd coreutils > /dev/null
  echo "$(brew --prefix coreutils)/libexec/gnubin" >> "$GITHUB_PATH"
  xcodebuild -version
  xcrun --sdk macosx --show-sdk-version
  # The source archive carries Linux's Python. Build steps need the Mac one, at the pinned version.
  version=$(sed -n "s/^ *'cpython3_version': '\([^']*\)',.*/\1/p" src/DEPS)
  test -n "$version"
  tools/chromium-test/cipd.sh infra/3pp/tools/cpython3/mac-arm64 "$version" src/third_party/cpython3/host
  src/third_party/cpython3/host/bin/python3 --version
  python3 -I tools/chromium-test/fetch-deps.py src \
    src/third_party/typescript/mac-arm64/src \
    src/third_party/llvm-libclang \
    src/ui/gl/resources/angle-metal \
    src/third_party/updater/chromium_mac_arm64/cipd \
    src/third_party/screen-ai/macos_arm64 \
    third_party/devtools-frontend/src:third_party/esbuild \
    +src/third_party/llvm-build/Release+Asserts
elif is_windows; then
  # The Windows SDK version Chromium requires, from Microsoft's installer, pinned by its hash.
  sdk_installer="$RUNNER_TEMP/winsdksetup.exe"
  curl -fsSL --retry 5 -o "$sdk_installer" "https://download.microsoft.com/download/e6cfffdc-0d3e-4c6c-96d7-d491da459a07/KIT_BUNDLE_WINDOWSSDK_MEDIACREATION/winsdksetup.exe"
  echo "e8e264aca8bc34abdf592352bf09f986a85cdb96db0efba405ca9e149181fe61  $sdk_installer" | sha256sum -c -
  MSYS2_ARG_CONV_EXCL="*" "$sdk_installer" /features OptionId.DesktopCPPx64 OptionId.DesktopCPPx86 OptionId.WindowsDesktopDebuggers /q /norestart
  test -f "/c/Program Files (x86)/Windows Kits/10/Include/10.0.28000.0/um/dcomp.h"
  python -I tools/chromium-test/fetch-deps.py src --windows-extras
  # Chromium's resource compiler, from the hash checked into the source.
  rc=src/build/toolchain/win/rc/win/rc.exe
  sha1=$(tr -d '[:space:]' < "$rc.sha1")
  curl -fsSL --retry 5 -o "$rc" "https://storage.googleapis.com/chromium-browser-clang/rc/$sha1"
  echo "$sha1  $rc" | sha1sum -c -
  touch -d 2020-01-01 "$rc"
  cygpath -w "$PWD/src/third_party/ninja" >> "$GITHUB_PATH"
  ls src/third_party/cpython3/host src/third_party/cpython3/host/bin 2>/dev/null | head -20
else
  sudo apt-get update -qq
  sudo apt-get install -y -qq ninja-build zstd python3 lld pkg-config > /dev/null
  cd src
  sudo build/install-build-deps.sh --no-prompt --no-arm --no-chromeos-fonts --no-nacl > /dev/null
fi
