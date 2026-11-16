#!/bin/bash
# Turns a release folder into a signed flat apt repository next to the .deb: Packages, Packages.gz,
# Release, InRelease and Release.gpg. The release's files are served from
# https://github.com/<owner/repo>/releases/latest/download/, which the Orbit package adds to apt
# (tools/chromium/linux/orbit.sources), so the newest release is always the repository.
#   ORBIT_APT_KEY=<armored private key> tools/apt-repo.sh <dist folder>
# ORBIT_APT_PUBLIC can name another public key to check against, for tests.
# Needs dpkg-scanpackages (dpkg-dev), apt-ftparchive (apt-utils) and gpg.
set -euo pipefail
dist=$(cd "$1" && pwd)
root=$(cd "$(dirname "$0")/.." && pwd)
: "${ORBIT_APT_KEY:?ORBIT_APT_KEY is required to sign the package list}"

home=$(mktemp -d)
trap 'gpgconf --homedir "$home" --kill all 2>/dev/null || true; rm -rf "$home"' EXIT
export GNUPGHOME="$home"
printf '%s\n' "$ORBIT_APT_KEY" | gpg --batch --quiet --import
fingerprint=$(gpg --batch --with-colons --list-secret-keys | awk -F: '/^fpr/ { print $10; exit }')
published=$(gpg --batch --with-colons --show-keys "${ORBIT_APT_PUBLIC:-$root/tools/chromium/linux/orbit-archive-keyring.asc}" | awk -F: '/^fpr/ { print $10; exit }')
if [ "$fingerprint" != "$published" ]; then
  echo "ORBIT_APT_KEY ($fingerprint) is not the key in tools/chromium/linux/orbit-archive-keyring.asc ($published)"
  exit 1
fi

cd "$dist"
dpkg-scanpackages --multiversion . /dev/null 2>/dev/null | sed 's|^Filename: \./|Filename: |' > Packages
grep -q '^Package: ' Packages
gzip -9 -k -n -f Packages
apt-ftparchive \
  -o APT::FTPArchive::Release::Origin=Orbit \
  -o APT::FTPArchive::Release::Label=Orbit \
  -o APT::FTPArchive::Release::Suite=stable \
  -o APT::FTPArchive::Release::Codename=stable \
  -o APT::FTPArchive::Release::Architectures=amd64 \
  -o "APT::FTPArchive::Release::Description=Orbit browser by NovaTech" \
  release . > "$home/Release"
mv "$home/Release" Release
gpg --batch --yes --local-user "$fingerprint" --clearsign --digest-algo SHA512 -o InRelease Release
gpg --batch --yes --local-user "$fingerprint" --armor --detach-sign --digest-algo SHA512 -o Release.gpg Release
gpg --batch --verify InRelease
