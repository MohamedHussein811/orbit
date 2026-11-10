#!/bin/bash
# Proves the result is a working browser, with its sandbox on.
set -euo pipefail

cd src/out/Release
profile=$(mktemp -d)
if [ "$(uname)" = "Darwin" ]; then
  du -sh Chromium.app
  browser=Chromium.app/Contents/MacOS/Chromium
elif [ -f chrome.exe ]; then
  ls -lh chrome.exe chrome.dll
  powershell -NoProfile -Command "(Get-Item chrome.exe).VersionInfo.ProductVersion"
  browser=./chrome.exe
  profile=$(cygpath -w "$profile")
else
  ls -lh chrome
  sandbox="$RUNNER_TEMP/chrome-sandbox"
  cp chrome_sandbox "$sandbox"
  sudo chown root:root "$sandbox"
  sudo chmod 4755 "$sandbox"
  export CHROME_DEVEL_SANDBOX="$sandbox"
  browser=./chrome
fi
if [ ! -f chrome.exe ]; then timeout 60 "$browser" --version; fi
timeout 180 "$browser" --headless --user-data-dir="$profile" --dump-dom "data:text/html,<title>built</title><h1 id=x>ok</h1>" | tee "$RUNNER_TEMP/dom.txt"
grep -q 'id="x">ok' "$RUNNER_TEMP/dom.txt"
echo "### Chromium built and ran on free runners ($(uname))" >> "$GITHUB_STEP_SUMMARY"
