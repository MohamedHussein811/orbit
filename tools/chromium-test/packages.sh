#!/bin/bash
# System packages. Every stage starts on a fresh machine, so each one installs them.
set -euo pipefail

sudo apt-get update -qq
sudo apt-get install -y -qq ninja-build zstd python3 lld pkg-config > /dev/null
cd src
sudo build/install-build-deps.sh --no-prompt --no-arm --no-chromeos-fonts --no-nacl > /dev/null
