#!/bin/bash
# Prints Orbit's GN build settings for one platform: tools/chromium/args.gn with that platform's
# differences. Windows and macOS build with proprietary codecs: MP4 reading from Chromium's FFmpeg,
# H.264 and AAC decoding from the operating system (orbit-media.patch). OpenH264 stays out, so no
# H.264 encoder is compiled in; encoding also goes through the operating system.
#
# Windows builds without the official, PGO and ThinLTO settings: with them the free 16 GB runner
# runs out of memory (notes/BUILD.md).
set -euo pipefail
here=$(dirname "$0")
case "${1:-}" in
  windows)
    sed -e 's/^proprietary_codecs = false/proprietary_codecs = true/' \
        -e 's/^is_official_build = true/is_official_build = false/' \
        -e 's/^use_thin_lto = true/use_thin_lto = false/' \
        -e 's/^chrome_pgo_phase = 2/chrome_pgo_phase = 0/' \
        -e '/^enable_dsyms = /d' "$here/args.gn" ;;
  mac) sed 's/^proprietary_codecs = false/proprietary_codecs = true/' "$here/args.gn" ;;
  linux) cat "$here/args.gn" ;;
  *) echo "usage: args-for.sh linux|windows|mac" >&2; exit 2 ;;
esac
