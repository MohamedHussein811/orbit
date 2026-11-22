#!/bin/bash
# Installs the APK on the running emulator, opens a page and reads the open tabs over DevTools.
# Usage: smoke.sh <apk>
set -euo pipefail
apk=$1
page="https://example.com/"
extension=kceipbaiojomdibnboffoieecidpfdck
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
  # Thread stacks Android wrote when the app stopped responding (needs adb root, done above).
  adb shell 'for f in /data/anr/*; do [ -f "$f" ] && echo "===== $f" && cat "$f"; done' > "$out/anr.txt" 2> /dev/null || true
  [ -s "$out/anr.txt" ] || rm -f "$out/anr.txt"
  if [ "$status" -ne 0 ]; then
    if [ -f "$out/anr.txt" ]; then
      echo "=== main thread when Orbit stopped responding ==="
      awk '/^Cmd line: '"$package"'$/{p=1} p&&/^"main"/{m=1} m{print} m&&/^$/{exit}' "$out/anr.txt" | head -80 || true
    fi
    echo "=== crash buffer ==="
    adb logcat -d -b crash | tail -120 || true
    echo "=== Chromium lines ==="
    grep -v "chrome_devtools_remote" "$out/logcat.txt" |
      grep -E "cr_|chromium|$package|DEBUG  |libc  |ndk_translation|AndroidRuntime|ActivityManager|ActivityTaskManager" |
      cut -c1-260 | tail -200 || true
  fi
  exit "$status"
}

# Google Play screenshots: 1080 x 1920 on the phone emulator, 2560 x 1440 on the tablet one.
store_shot() {
  adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS > /dev/null 2>&1 || true
  sleep 1
  adb shell screencap -p /sdcard/store.png > /dev/null 2>&1 && adb pull /sdcard/store.png "$out/store-$1.png" > /dev/null || true
}
open_page() {
  adb shell am start -a android.intent.action.VIEW -d "$1" -n "$package/com.google.android.apps.chrome.Main" > /dev/null
  sleep 20
}
store_shots() {
  size=$(adb shell wm size | sed -n 's/.*: *\([0-9]*\)x\([0-9]*\).*/\1 \2/p' | tail -1)
  tablet=no
  if [ "${size% *}" -gt "${size#* }" ]; then
    tablet=yes
    # The launcher's taskbar shows other apps' icons, and the slow emulator makes it stop
    # responding; the screenshots do not need it.
    for launcher in com.google.android.apps.nexuslauncher com.android.launcher3; do
      adb shell pm disable-user --user 0 "$launcher" > /dev/null 2>&1 || true
    done
  fi
  open_page "https://github.com/MohamedHussein811/orbit/blob/main/PRIVACY.md"
  store_shot 2
  if [ "$tablet" = yes ]; then
    # The new tab button in the tab strip (2560 x 1440 screen).
    adb shell input tap 1015 86
  else
    # The new tab button in the bottom toolbar.
    adb shell input tap 405 1778
  fi
  sleep 8
  store_shot 1
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
    if [ "$package" != org.chromium.chrome ] && [ "$label" != Orbit ]; then
      echo "::error::the app is named $label"
      finish 1
    fi
    store_shots
    for wait in $(seq 5 5 90); do
      targets=$(curl -fsS http://127.0.0.1:9222/json/list 2> /dev/null || true)
      if echo "$targets" | grep -q "chrome-extension://$extension/"; then
        echo "built-in extension running after $wait more seconds"
        finish 0
      fi
      sleep 5
    done
    echo "$targets"
    if [ "$package" = org.chromium.chrome ]; then
      echo "plain Chromium APK: no built-in extension to check"
      finish 0
    fi
    echo "::error::Orbit's built-in extension is not running"
    finish 1
  fi
done
echo "tabs: ${tabs:-none}"
echo "::error::the page did not load within 5 minutes"
finish 1
