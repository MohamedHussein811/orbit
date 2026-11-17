#!/bin/bash
# Installs the APK on the running emulator, opens a page and reads the open tabs over DevTools.
# Usage: smoke.sh <apk>
set -euo pipefail
apk=$1
package=org.chromium.chrome
page="https://example.com/"

adb wait-for-device
echo "emulator ABIs: $(adb shell getprop ro.product.cpu.abilist)"
abi=$(unzip -l "$apk" | sed -n 's|.*lib/\([^/]*\)/.*\.so$|\1|p' | sort -u | head -1)
echo "APK ABI: $abi"
case "$(adb shell getprop ro.product.cpu.abilist)" in
  *"$abi"*) ;;
  *) echo "::error::the emulator cannot run $abi code"; exit 1 ;;
esac

ls -lh "$apk"
adb install -r -g "$apk"
adb root > /dev/null 2>&1 || true
adb wait-for-device
flags="_ --disable-fre --no-default-browser-check --no-first-run --enable-remote-debugging"
adb shell "echo '$flags' > /data/local/tmp/chrome-command-line"
adb shell "echo '$flags' > /data/local/chrome-command-line" 2> /dev/null || true

adb shell am start -W -a android.intent.action.VIEW -d "$page" -n "$package/com.google.android.apps.chrome.Main"
adb forward tcp:9222 localabstract:chrome_devtools_remote

for _ in $(seq 1 60); do
  tabs=$(curl -fsS http://127.0.0.1:9222/json/list 2> /dev/null || true)
  if echo "$tabs" | grep -q '"title": *"Example Domain"'; then
    echo "$tabs"
    curl -fsS http://127.0.0.1:9222/json/version
    adb shell dumpsys package "$package" | grep -E "versionName|versionCode" | head -2
    echo "page loaded"
    exit 0
  fi
  sleep 5
done
echo "tabs: ${tabs:-none}"
adb shell screencap -p /sdcard/smoke.png && adb pull /sdcard/smoke.png "${RUNNER_TEMP:-.}/smoke.png" || true
adb logcat -d -t 300 | grep -iE "chromium|chrome|crash|fatal" | tail -80 || true
echo "::error::the page did not load within 5 minutes"
exit 1
