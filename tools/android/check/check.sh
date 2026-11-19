#!/bin/bash
# Runs on the emulator job: installs the APK fresh (no first-run switches) and runs check.mjs, which
# records the first launch, the new tab pages, the clock and a crawl of every app menu item.
# Usage: check.sh <apk> <out dir>
set -uo pipefail
apk=$1
out=$2
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$out"

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}
aapt2=$(ls "$sdk"/build-tools/*/aapt2 | sort -V | tail -1)
"$aapt2" dump badging "$apk" > "$out/badging.txt"
package=$(sed -n "s/^package: name='\([^']*\)'.*/\1/p" "$out/badging.txt")
echo "package $package"
echo "=== features"
grep -E "uses-(implied-)?feature" "$out/badging.txt" || true
required=$(grep -E "^\s*uses-feature(-sdk-23)?: name='android.hardware.(wifi|bluetooth|location)'" "$out/badging.txt" || true)
if [ -n "$required" ]; then echo "required hardware features: $required"; else echo "wifi, bluetooth and location are optional"; fi
# Default (English) strings in the APK that still name Chrome or Chromium.
"$aapt2" dump strings "$apk" > "$out/strings.txt" 2> /dev/null || true
grep -E "\bChrom(e|ium)\b" "$out/strings.txt" | grep -vE "Chrome Web Store|ChromeOS|Chromebook|chrome://|chrome-|Chromium Authors" > "$out/chrome-strings.txt" || true
echo "=== $(wc -l < "$out/chrome-strings.txt") resource strings name Chrome or Chromium"
head -40 "$out/chrome-strings.txt"

adb wait-for-device
# No -g: runtime permissions start ungranted, as after a store install.
adb install -r "$apk"
adb root > /dev/null 2>&1 || true
adb wait-for-device
# DevTools only, so the first run is the one users get.
flags="_ --enable-remote-debugging --remote-debugging-socket-name=chrome_devtools_remote"
adb shell "echo '$flags' > /data/local/tmp/chrome-command-line"
adb shell "echo '$flags' > /data/local/chrome-command-line" 2> /dev/null || true
adb shell settings put global package_verifier_enable 0 > /dev/null 2>&1 || true
# The launcher stops responding on the slow emulator and covers the screen with its dialog; the
# check starts Orbit with intents and does not need it.
for launcher in com.google.android.apps.nexuslauncher com.android.launcher3; do
  adb shell pm disable-user --user 0 "$launcher" > /dev/null 2>&1 || true
done
adb forward tcp:9222 localabstract:chrome_devtools_remote
adb logcat -c
adb logcat -b crash -c

status=0
node "$here/check.mjs" "$package" "$out" || status=$?
adb logcat -d -v threadtime > "$out/logcat.txt" 2> /dev/null || true
adb logcat -d -b crash > "$out/crash.txt" 2> /dev/null || true
# Main thread stacks of any "isn't responding" (ANR) moments.
adb pull /data/anr "$out/anr" > /dev/null 2>&1 || true
grep -l "org.novatech.orbit" "$out"/anr/* 2> /dev/null | while read -r trace; do
  echo "=== ANR $(basename "$trace"): main thread"
  sed -n '/^"main"/,/^$/p' "$trace" | head -40
done
echo "=== crash buffer"
head -150 "$out/crash.txt"
echo "=== fatal lines"
grep -E "FATAL EXCEPTION|Fatal signal|am_crash|ANR in" "$out/logcat.txt" | head -40 || true
exit $status
