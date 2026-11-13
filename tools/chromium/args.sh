#!/bin/bash
# Writes Orbit's build settings (tools/chromium/args.gn) to the given file, leaving it untouched
# when nothing changed. Windows builds with proprietary codecs: MP4 reading from Chromium's FFmpeg,
# H.264 and AAC decoding from the operating system (orbit-media.patch).
set -euo pipefail
dest=$1
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) sed 's/^proprietary_codecs = false/proprietary_codecs = true/' "$(dirname "$0")/args.gn" > "$dest.new" ;;
  *) cp "$(dirname "$0")/args.gn" "$dest.new" ;;
esac
if cmp -s "$dest.new" "$dest"; then rm "$dest.new"; else mv "$dest.new" "$dest"; fi
