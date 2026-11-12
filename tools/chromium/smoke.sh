#!/bin/bash
# Proves the result is a working browser named Orbit, with its sandbox on and its own profile folder.
set -euo pipefail

product=$(sed -n 's/^PRODUCT_FULLNAME=//p' src/chrome/app/theme/chromium/BRANDING)
cd src/out/Release
profile=$(mktemp -d)
if [ "$(uname)" = "Darwin" ]; then
  du -sh "$product.app"
  browser="$product.app/Contents/MacOS/$product"
  data_dir="$HOME/Library/Application Support/$product"
elif [ -f chrome.exe ]; then
  ls -lh chrome.exe chrome.dll
  name=$(powershell -NoProfile -Command "(Get-Item chrome.exe).VersionInfo.ProductName")
  powershell -NoProfile -Command "(Get-Item chrome.exe).VersionInfo | Format-List ProductName, ProductVersion, CompanyName, LegalCopyright"
  test "$(echo "$name" | tr -d '\r')" = "$product"
  browser=./chrome.exe
  data_dir="$(cygpath -u "$LOCALAPPDATA")/NovaTech/$product/User Data"
  # The Windows sandbox runs child processes as app containers, which need read access to the
  # browser folder. GitHub runner folders do not grant it, unlike a normal install location.
  MSYS2_ARG_CONV_EXCL="*" icacls "$(cygpath -w "$PWD")" /grant "*S-1-15-2-1:(OI)(CI)(RX)" /grant "*S-1-15-2-2:(OI)(CI)(RX)" /T /Q > /dev/null
  profile=$(cygpath -w "$profile")
  export MSYS2_ARG_CONV_EXCL="*"
else
  ls -lh chrome
  sandbox="$RUNNER_TEMP/chrome-sandbox"
  cp chrome_sandbox "$sandbox"
  sudo chown root:root "$sandbox"
  sudo chmod 4755 "$sandbox"
  export CHROME_DEVEL_SANDBOX="$sandbox"
  browser=./chrome
  data_dir="${XDG_CONFIG_HOME:-$HOME/.config}/$(echo "$product" | tr '[:upper:]' '[:lower:]')"
fi

if [ ! -f chrome.exe ]; then
  version=$(timeout 60 "$browser" --version)
  echo "$version"
  case "$version" in "$product "*) ;; *) echo "expected the version line to start with $product"; exit 1 ;; esac
fi
timeout 180 "$browser" --headless --user-data-dir="$profile" --dump-dom "data:text/html,<title>built</title><h1 id=x>ok</h1>" | tee "$RUNNER_TEMP/dom.txt"
grep -q 'id="x">ok' "$RUNNER_TEMP/dom.txt"

# A normal start, without a profile switch, must create Orbit's own data folder.
test ! -e "$data_dir/Default"
flags=(--no-first-run --no-default-browser-check about:blank)
if [ "$(uname)" = "Darwin" ]; then
  timeout 30 "$browser" --use-mock-keychain "${flags[@]}" || true
elif [ -f chrome.exe ]; then
  "$browser" "${flags[@]}" &
  sleep 30
  taskkill /F /T /IM chrome.exe > /dev/null 2>&1 || true
else
  command -v xvfb-run > /dev/null || sudo apt-get install -y -qq xvfb > /dev/null
  timeout 30 xvfb-run -a "$browser" --password-store=basic "${flags[@]}" || true
fi
ls -la "$data_dir"
test -d "$data_dir/Default"

extension=$(ls ../../chrome/browser/resources/orbit_extensions/*.json | xargs -n1 basename | sed 's/\.json$//')
ls "$data_dir/Default/Extensions/$extension"

# Privacy defaults, Settings data, the built-in extension and its new tab page.
if [ -f chrome.exe ]; then
  native_browser=$(cygpath -w "$PWD/chrome.exe")
  check_flags=()
elif [ "$(uname)" = "Darwin" ]; then
  native_browser="$PWD/$browser"
  check_flags=(--use-mock-keychain)
else
  native_browser="$PWD/chrome"
  check_flags=(--password-store=basic)
fi
node "$GITHUB_WORKSPACE/tools/chromium/check-browser.mjs" "$native_browser" "$extension" "${check_flags[@]}"

echo "### $product built and ran on free runners ($(uname))" >> "$GITHUB_STEP_SUMMARY"
