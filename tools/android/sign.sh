#!/bin/bash
# Signs the arm64 APK and Play bundle with Orbit's Android upload key.
# Usage: sign.sh <ChromePublic.apk> <ChromePublic.aab> <output folder> <version>
# Env: KEYSTORE (base64 PKCS12 keystore, key alias "orbit"), ANDROID_UPLOAD_KEYSTORE_PASSWORD.
# Writes Orbit-<version>-android-arm64.apk and Orbit-<version>.aab.
set -euo pipefail
apk_in=$1
aab_in=$2
out=$3
version=$4
[ -n "${KEYSTORE:-}" ] && [ -n "${ANDROID_UPLOAD_KEYSTORE_PASSWORD:-}" ] || {
  echo "::error::Set the ANDROID_UPLOAD_KEYSTORE_* secrets (docs/RELEASING.md)"
  exit 1
}
keystore=$(mktemp)
trap 'rm -f "$keystore"' EXIT
echo "$KEYSTORE" | base64 --decode > "$keystore"
sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}
tools=$(ls -d "$sdk"/build-tools/* | sort -V | tail -1)
mkdir -p "$out"

apk="$out/Orbit-$version-android-arm64.apk"
"$tools/apksigner" sign --ks "$keystore" --ks-type PKCS12 --ks-pass env:ANDROID_UPLOAD_KEYSTORE_PASSWORD \
  --ks-key-alias orbit --out "$apk" "$apk_in"
"$tools/apksigner" verify --print-certs "$apk" | grep -E "Signer #1 certificate (DN|SHA-256)"

aab="$out/Orbit-$version.aab"
cp "$aab_in" "$aab"
zip -q -d "$aab" 'META-INF/*' || true
jarsigner -keystore "$keystore" -storetype PKCS12 -storepass:env ANDROID_UPLOAD_KEYSTORE_PASSWORD \
  -sigalg SHA256withRSA -digestalg SHA-256 "$aab" orbit > /dev/null
jarsigner -verify "$aab" | tail -1
