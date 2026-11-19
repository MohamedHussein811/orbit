#!/bin/bash
# Runs on the emulator job: installs the APK, serves the demo page and records the videos.
# Usage: demo.sh <apk> <out dir>
set -euo pipefail
apk=$1
out=$2
here=$(cd "$(dirname "$0")" && pwd)
site=$(mktemp -d)

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-/usr/local/lib/android/sdk}}
aapt2=$(ls "$sdk"/build-tools/*/aapt2 | sort -V | tail -1)
package=$("$aapt2" dump badging "$apk" | sed -n "s/^package: name='\([^']*\)'.*/\1/p")
echo "package $package"

adb wait-for-device
adb install -r -g "$apk"
adb root > /dev/null 2>&1 || true
adb wait-for-device
flags="_ --disable-fre --no-default-browser-check --no-first-run --enable-remote-debugging --remote-debugging-socket-name=chrome_devtools_remote"
adb shell "echo '$flags' > /data/local/tmp/chrome-command-line"
adb shell "echo '$flags' > /data/local/chrome-command-line" 2> /dev/null || true

cp -r "$here/page/." "$site/"
mkdir -p "$site/files"
small=$(adb shell 'ls -S /system/app/*/*.apk 2> /dev/null' | tr -d '\r' | tail -1)
adb pull "$small" "$site/files/sample.apk" > /dev/null
python3 -I -c '
import math, struct, sys, wave
w = wave.open(sys.argv[1], "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(22050)
w.writeframes(b"".join(struct.pack("<h", int(6000 * math.sin(2 * math.pi * 440 * i / 22050))) for i in range(22050 * 20)))
' "$site/files/tone.wav"
python3 -I "$here/serve.py" "$site" &
adb reverse tcp:8000 tcp:8000
adb forward tcp:9222 localabstract:chrome_devtools_remote

node "$here/demo.mjs" "$package" "$out"
ls -la "$out"
