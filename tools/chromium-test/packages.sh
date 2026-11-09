#!/bin/bash
# System packages and host tools. Every stage starts on a fresh machine, so each one installs them.
set -euo pipefail

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
else
  sudo apt-get update -qq
  sudo apt-get install -y -qq ninja-build zstd python3 lld pkg-config > /dev/null
  cd src
  sudo build/install-build-deps.sh --no-prompt --no-arm --no-chromeos-fonts --no-nacl > /dev/null
fi
