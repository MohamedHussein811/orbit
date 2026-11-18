#!/bin/bash
# Installs the APK on the running emulator, opens a page and reads the open tabs over DevTools.
# Usage: smoke.sh <apk>
set -euo pipefail
apk=$1
page="https://example.com/"
out=${RUNNER_TEMP:-.}

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}
aapt2=$(ls "$sdk"/build-tools/*/aapt2 | sort -V | tail -1)
badging=$("$aapt2" dump badging "$apk")
package=$(echo "$badging" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
label=$(echo "$badging" | sed -n "s/^application-label:'\(.*\)'$/\1/p")
version=$(echo "$badging" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p")
echo "package $package, name $label, version $version"
test -n "$package"

adb wait-for-device
abis=$(adb shell getprop ro.product.cpu.abilist | tr -d '\r')
echo "emulator ABIs: $abis"
abi=$(unzip -l "$apk" | sed -n 's|.*lib/\([^/]*\)/.*\.so$|\1|p' | sort -u | head -1)
echo "APK ABI: $abi"
case "$abis" in
  *"$abi"*) ;;
  *) echo "::error::the emulator cannot run $abi code"; exit 1 ;;
esac

ls -lh "$apk"
adb install -r -g "$apk"
adb root > /dev/null 2>&1 || true
adb wait-for-device
flags="_ --disable-fre --no-default-browser-check --no-first-run --enable-remote-debugging --remote-debugging-socket-name=chrome_devtools_remote"
adb shell "echo '$flags' > /data/local/tmp/chrome-command-line"
adb shell "echo '$flags' > /data/local/chrome-command-line" 2> /dev/null || true
echo "debuggable: $(adb shell getprop ro.debuggable | tr -d '\r')"

finish() {
  status=$1
  adb shell screencap -p /sdcard/smoke.png > /dev/null 2>&1 && adb pull /sdcard/smoke.png "$out/smoke.png" > /dev/null || true
  adb logcat -d -v threadtime > "$out/logcat.txt" 2> /dev/null || true
  if [ "$status" -ne 0 ]; then
    echo "=== crash buffer ==="
    adb logcat -d -b crash | tail -120 || true
    echo "=== Chromium lines ==="
    grep -v "chrome_devtools_remote" "$out/logcat.txt" |
      grep -E "cr_|chromium|$package|DEBUG  |libc  |ndk_translation|AndroidRuntime|ActivityManager|ActivityTaskManager" |
      cut -c1-260 | tail -200 || true
  fi
  exit "$status"
}

adb logcat -c
adb shell am start -W -a android.intent.action.VIEW -d "$page" -n "$package/com.google.android.apps.chrome.Main"
adb forward tcp:9222 localabstract:chrome_devtools_remote

tabs=""
for second in $(seq 5 5 300); do
  sleep 5
  if ! adb shell pidof "$package" > /dev/null 2>&1; then
    echo "::error::$package is not running after $second seconds"
    finish 1
  fi
  tabs=$(curl -fsS http://127.0.0.1:9222/json/list 2> /dev/null || true)
  if echo "$tabs" | grep -q '"title": *"Example Domain"'; then
    echo "$tabs"
    curl -fsS http://127.0.0.1:9222/json/version || true
    adb shell dumpsys package "$package" | grep -E "versionName|versionCode" | head -2
    echo "page loaded after $second seconds"
    finish 0
  fi
done
echo "tabs: ${tabs:-none}"
echo "::error::the page did not load within 5 minutes"
finish 1
