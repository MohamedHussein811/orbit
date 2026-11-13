#!/bin/bash
# Packages the finished browser for people to install, into dist/:
#   Windows  OrbitSetup-<version>-x64.exe (Chromium's installer, per-user)
#   macOS    Orbit-<version>-mac-arm64.dmg, signed and notarized when the signing secrets are set
#   Linux    orbit_<version>_amd64.deb and Orbit-<version>-linux-x64.tar.xz
set -euo pipefail
is_windows() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; esac; return 1; }

root=$PWD
product=$(sed -n 's/^PRODUCT_FULLNAME=//p' src/chrome/app/theme/chromium/BRANDING)
version=$(. src/chrome/VERSION && echo "$MAJOR.$MINOR.$BUILD.$PATCH")
dist="$root/dist"
mkdir -p "$dist"
cd src/out/Release

if [ "$(uname)" = "Darwin" ]; then
  if [ -n "${MAC_CERTIFICATE_P12_BASE64:-}" ]; then
    work="$RUNNER_TEMP/signing"
    mkdir -p "$work"
    keychain="$work/orbit.keychain-db"
    keychain_password=$(openssl rand -hex 24)
    echo "$MAC_CERTIFICATE_P12_BASE64" | base64 --decode > "$work/certificate.p12"
    security create-keychain -p "$keychain_password" "$keychain"
    security set-keychain-settings -lut 21600 "$keychain"
    security unlock-keychain -p "$keychain_password" "$keychain"
    security import "$work/certificate.p12" -k "$keychain" -P "$MAC_CERTIFICATE_PASSWORD" -T /usr/bin/codesign
    security set-key-partition-list -S apple-tool:,apple: -s -k "$keychain_password" "$keychain" > /dev/null
    security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"')
    echo "$APPLE_NOTARY_KEY_P8_BASE64" | base64 --decode > "$work/notary.p8"
    rm -rf signed
    python3 "$product Packaging/sign_chrome.py" \
      --input . --output signed --identity "$MAC_SIGNING_IDENTITY" --notarize staple \
      --notary-arg=--key --notary-arg="$work/notary.p8" \
      --notary-arg=--key-id --notary-arg="$APPLE_NOTARY_KEY_ID" \
      --notary-arg=--issuer --notary-arg="$APPLE_NOTARY_ISSUER_ID"
    dmg=$(ls signed/*.dmg | head -1)
    cp "$dmg" "$dist/$product-$version-mac-arm64.dmg"
    security delete-keychain "$keychain"
    rm -rf "$work"
  else
    staging="$RUNNER_TEMP/dmg"
    rm -rf "$staging"
    mkdir -p "$staging"
    ditto "$product.app" "$staging/$product.app"
    ln -s /Applications "$staging/Applications"
    hdiutil create -volname "$product" -srcfolder "$staging" -ov -format UDZO \
      "$dist/$product-$version-mac-arm64-unsigned.dmg"
  fi
elif is_windows; then
  cp mini_installer.exe "$dist/${product}Setup-$version-x64.exe"
else
  name=$(echo "$product" | tr '[:upper:]' '[:lower:]')
  tree="$RUNNER_TEMP/$name-package"
  app="$tree/opt/novatech/$name"
  rm -rf "$tree"
  mkdir -p "$app" "$tree/usr/bin" "$tree/usr/share/applications" "$tree/DEBIAN"
  cp chrome chrome_crashpad_handler "$app/"
  cp chrome_sandbox "$app/chrome-sandbox"
  for file in *.pak *.bin *.dat *.so *.so.* *.json; do
    [ -f "$file" ] && cp "$file" "$app/"
  done
  for folder in locales resources MEIPreload WidevineCdm PrivacySandboxAttestationsPreloaded IwaKeyDistribution; do
    [ -d "$folder" ] && cp -r "$folder" "$app/"
  done
  find "$app/locales" -type f ! -name '*.pak' -delete
  cat > "$app/$name" <<EOF
#!/bin/sh
export CHROME_WRAPPER="\$(readlink -f "\$0")"
exec "/opt/novatech/$name/chrome" "\$@"
EOF
  chmod 755 "$app/$name"
  ln -s "/opt/novatech/$name/$name" "$tree/usr/bin/$name"
  for size in 16 24 48 64 128 256; do
    mkdir -p "$tree/usr/share/icons/hicolor/${size}x${size}/apps"
    cp "$root/src/chrome/app/theme/chromium/product_logo_$size.png" \
      "$tree/usr/share/icons/hicolor/${size}x${size}/apps/$name.png"
  done
  cat > "$tree/usr/share/applications/$name.desktop" <<EOF
[Desktop Entry]
Version=1.0
Name=$product
GenericName=Web Browser
Comment=Private, fast web browsing
Exec=/usr/bin/$name %U
Terminal=false
Icon=$name
Type=Application
Categories=Network;WebBrowser;
MimeType=text/html;text/xml;application/xhtml+xml;x-scheme-handler/http;x-scheme-handler/https;
StartupNotify=true
Actions=new-window;new-private-window;

[Desktop Action new-window]
Name=New Window
Exec=/usr/bin/$name

[Desktop Action new-private-window]
Name=New Private Window
Exec=/usr/bin/$name --incognito
EOF

  tar -C "$tree/opt/novatech" -cJf "$dist/$product-$version-linux-x64.tar.xz" "$name"

  chmod 4755 "$app/chrome-sandbox"
  size=$(du -sk "$tree/opt" | cut -f1)
  cat > "$tree/DEBIAN/control" <<EOF
Package: $name-browser
Version: $version
Architecture: amd64
Maintainer: NovaTech
Installed-Size: $size
Section: web
Priority: optional
Provides: www-browser
Depends: libasound2t64 | libasound2, libatk-bridge2.0-0t64 | libatk-bridge2.0-0, libatk1.0-0t64 | libatk1.0-0, libc6, libcairo2, libcups2t64 | libcups2, libdbus-1-3, libdrm2, libexpat1, libgbm1, libglib2.0-0t64 | libglib2.0-0, libgtk-3-0t64 | libgtk-3-0, libnspr4, libnss3, libpango-1.0-0, libx11-6, libxcb1, libxcomposite1, libxdamage1, libxext6, libxfixes3, libxkbcommon0, libxrandr2, xdg-utils
Description: $product web browser
 A private, fast web browser by NovaTech, built on Chromium, with built-in
 ad and tracker blocking.
EOF
  dpkg-deb --root-owner-group -Zxz --build "$tree" "$dist/${name}_${version}_amd64.deb"
  rm -rf "$tree"

  # The built-in extension, signed with Orbit's key, for Shields updates between releases.
  extensions="$root/src/chrome/browser/resources/orbit_extensions"
  cp "$extensions/orbit.crx" "$dist/orbit-extension.crx"
  cp "$extensions"/*.json "$dist/orbit-extension.json"
fi

cd "$dist"
ls -lh
