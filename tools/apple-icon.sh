#!/bin/bash
# Writes the iPhone app icon (one 1024 px image, no transparency, as the App Store requires) into
# an asset catalog, rendered with rsvg-convert from the glyph in branding/orbit-mark.svg.
# Usage: apple-icon.sh <Assets.xcassets folder>
set -euo pipefail
catalog=$1
set_dir="$catalog/AppIcon.appiconset"
mkdir -p "$set_dir"
svg="${TMPDIR:-/tmp}/orbit-icon-$$.svg"
cat > "$svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#0b0b0d"/>
  <g transform="translate(512 512) scale(1.6) translate(-256 -256)">
    <path d="M385.43 221.32 A134 134 0 1 1 290.68 126.57" fill="none" stroke="#ffffff" stroke-width="46" stroke-linecap="round"/>
    <circle cx="350.75" cy="161.25" r="30" fill="#ffffff"/>
  </g>
</svg>
SVG
rsvg-convert -w 1024 -h 1024 -b "#0b0b0d" "$svg" -o "$set_dir/icon-1024.png"
rm -f "$svg"
cat > "$catalog/Contents.json" <<'JSON'
{ "info" : { "author" : "xcode", "version" : 1 } }
JSON
cat > "$set_dir/Contents.json" <<'JSON'
{
  "images" : [
    { "filename" : "icon-1024.png", "idiom" : "universal", "platform" : "ios", "size" : "1024x1024" }
  ],
  "info" : { "author" : "xcode", "version" : 1 }
}
JSON
echo "app icon written to $set_dir"
