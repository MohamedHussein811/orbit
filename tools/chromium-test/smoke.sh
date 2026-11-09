#!/bin/bash
# Proves the result is a working browser, with its sandbox on.
set -euo pipefail

cd src/out/Release
ls -lh chrome
sandbox="$RUNNER_TEMP/chrome-sandbox"
cp chrome_sandbox "$sandbox"
sudo chown root:root "$sandbox"
sudo chmod 4755 "$sandbox"
export CHROME_DEVEL_SANDBOX="$sandbox"
timeout 60 ./chrome --version
profile=$(mktemp -d)
timeout 180 ./chrome --headless --user-data-dir="$profile" --dump-dom "data:text/html,<title>built</title><h1 id=x>ok</h1>" | tee "$RUNNER_TEMP/dom.txt"
grep -q 'id="x">ok' "$RUNNER_TEMP/dom.txt"
echo "### Chromium built and ran on free runners" >> "$GITHUB_STEP_SUMMARY"
