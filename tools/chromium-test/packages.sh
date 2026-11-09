#!/bin/bash
# System packages every stage needs.
set -euo pipefail

sudo apt-get update -qq
sudo apt-get install -y -qq ninja-build zstd python3 lld pkg-config > /dev/null
