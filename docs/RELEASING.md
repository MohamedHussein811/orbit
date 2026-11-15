# Building and releasing

This describes the process as it stands. Steps marked "not built" do not exist yet.

## Build

Builds run on GitHub's runners through `.github/workflows/browser-windows.yml`, `browser-mac.yml` and `browser-linux.yml`, on pushes to the `fork` and `design` branches that touch the browser. Each workflow chains stages of `chromium-stage.yml`, because one runner job is limited in time. A stage can continue from a stage saved by an earlier run (`resume_run`), so a small change recompiles only what depends on it.

Each stage downloads and verifies the Chromium source, builds and signs the built-in extension, applies Orbit's changes with `tools/chromium/apply-fork.py`, compiles, and saves its state. The last stage runs `tools/chromium/smoke.sh`, which starts the browser and runs `tools/chromium/check-browser.mjs`.

## Test

```sh
npm run typecheck
npm run test:unit
node tools/chromium/check-browser.mjs <path to a built Orbit> kceipbaiojomdibnboffoieecidpfdck
node tools/chromium/window-shots.mjs <orbit.exe> <out folder> en dark,light
```

`window-shots.mjs` captures Orbit's own windows on Windows for design review.

## Chromium updates

The Chromium version is pinned in `.github/workflows/chromium-stage.yml` (`CHROMIUM_VERSION`). `.github/workflows/engine-watch.yml` runs every Monday: it takes the newest stable version that Windows, macOS and Linux all have, applies Orbit's patch series to that source, and then either opens a pull request into `design` that moves the pin (merging starts the builds) or opens an issue naming the patches that no longer apply. Security fixes should ship within days, so release soon after such a pull request builds green. A new major version can also need newer build tools; check its first build closely.

## Filter list updates

`.github/workflows/filters-update.yml` runs weekly and opens a pull request with new rules in `filters/rules`. It refuses a list that looks truncated. Check the rule counts in `filters/rules/meta.json` for a large unexplained drop, then merge when CI passes.

## Packaging, signing and release

The last build stage runs `tools/chromium/package.sh` after the browser check and keeps the result as the `orbit-package-<system>` artifact for 30 days:

| System | Package | Notes |
| --- | --- | --- |
| Windows | `OrbitSetup-<version>-x64.exe` | A setup window (`tools/chromium/installer/orbit.iss`) around Chromium's installer (`mini_installer`). Installs for the current user into `%LOCALAPPDATA%\NovaTech\Orbit`, no administrator rights. Code-signed in the release workflow when signing is set up |
| macOS | `Orbit-<version>-mac-arm64.dmg` | Signed with Chromium's `sign_chrome.py` and notarized when the signing secrets below are set; otherwise `-unsigned.dmg` |
| Linux | `orbit_<version>_amd64.deb`, `Orbit-<version>-linux-x64.tar.xz` | Installs to `/opt/novatech/orbit` with `/usr/bin/orbit`, a desktop entry, icons, and Orbit's apt package list (`/etc/apt/sources.list.d/orbit.sources`, key in `/usr/share/keyrings`) |

The Linux job also keeps the signed built-in extension (`orbit-extension.crx`).

### macOS signing secrets

Set these repository secrets to sign and notarize the disk image. Without them the build still produces an unsigned one.

| Secret | Value |
| --- | --- |
| `MAC_CERTIFICATE_P12_BASE64` | The Developer ID Application certificate and its private key, exported as .p12, then base64 |
| `MAC_CERTIFICATE_PASSWORD` | The .p12 export password |
| `MAC_SIGNING_IDENTITY` | The certificate's name, such as `Developer ID Application: NovaTech (TEAMID)` |
| `APPLE_NOTARY_KEY_P8_BASE64` | An App Store Connect API key (.p8), base64 |
| `APPLE_NOTARY_KEY_ID` | That key's id |
| `APPLE_NOTARY_ISSUER_ID` | The issuer id shown with App Store Connect API keys |

### Windows signing

The release workflow signs `OrbitSetup-<version>-x64.exe`, the one file people download and the updater runs. The first of these that is set up is used; with neither, the setup stays unsigned and the release notes say so.

**SignPath Foundation** (free for open source; the publisher shown is "SignPath Foundation"). Apply at https://signpath.org/apply. Their rules ask for the code signing policy in the README (present), MFA on GitHub and SignPath for everyone on the team, a privacy policy shown during setup (the welcome page links [PRIVACY.md](../PRIVACY.md) and the setup has an automatic updates choice), and manual approval of every signing request. Once approved, create in SignPath a project with a GitHub Actions trusted build system, an artifact configuration that signs the PE file inside the uploaded zip, and a release signing policy, then set:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `SIGNPATH_API_TOKEN` | An API token of a SignPath CI user that may submit to the policy |
| Variable | `SIGNPATH_ORGANIZATION_ID` | The organization id |
| Variable | `SIGNPATH_PROJECT_SLUG` | The project slug, such as `orbit` |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | Such as `release-signing` |
| Variable | `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` | Such as `orbit-setup` |

The workflow waits up to five hours for an approver.

**A certificate of your own** (if SignPath declines; OV certificates cost about $200 to $400 a year and keep their private key on a token or in a cloud service): set `WINDOWS_CERTIFICATE_PFX_BASE64` (the .pfx, base64) and `WINDOWS_CERTIFICATE_PASSWORD`. The workflow signs with osslsigncode and a DigiCert timestamp. A certificate that only lives in a cloud service, such as Azure Artifact Signing, needs a signing step for that service instead.

### Update keys

Two keys sign what installed copies trust. Their private parts are repository secrets and never leave them; their public parts are in the repository.

| Secret | Public part | Signs |
| --- | --- | --- |
| `ORBIT_UPDATE_KEY` | `chromium/update-key.pub`, built into the browser | `orbit-update.json`, the Windows updater's feed (Ed25519) |
| `ORBIT_APT_KEY` | `tools/chromium/linux/orbit-archive-keyring.asc`, shipped in the .deb | The apt package list (OpenPGP, Ed25519) |

Losing a private key means installed copies can no longer be updated by that route; keep an offline backup. Replacing a key needs a release that ships the new public part, signed with the old key.

### Version numbers

Every release must carry a higher browser version, or installers treat it as already installed. Orbit puts its release number in the version's second part: `chromium/ORBIT_RELEASE` holds it, and `apply-fork.py` writes it into `chrome/VERSION` (157.**1**.8103.78). Raise it by one before the builds of each release.

### Publishing a release

Run the **Release** workflow by hand with a tag (`vX.Y.Z`) and the run ids of green Windows, Mac and Linux builds of the same commit. It downloads their packages, runs `tools/release-files.mjs` and publishes a GitHub Release with:

- the installers and Linux packages,
- `orbit-extension.crx` and `orbit-extension-updates.xml`: the built-in extension's `update_url` points at `releases/latest/download/orbit-extension-updates.xml`, so installed copies get new Shields rules from each release without reinstalling. Updates must be signed with the same extension key (`ORBIT_EXTENSION_KEY`), and the extension version is the commit count, so it always increases,
- `latest.json`: the new tab page checks it once a day (Orbit privacy page, "Orbit updates", on by default) and shows a note when a release carries a newer browser,
- `orbit-update.json` and `orbit-update.json.sig`: the Windows updater's feed (version, setup address, size, SHA-256), signed with `ORBIT_UPDATE_KEY`,
- `Packages`, `Packages.gz`, `Release`, `InRelease`, `Release.gpg`: a flat apt repository signed with `ORBIT_APT_KEY` (`tools/apt-repo.sh`), served from `releases/latest/download/`,
- `SHA256SUMS.txt` for every file.

## How installed copies update

- **Windows** (`orbit-updater.patch`): four minutes after start and then every five hours, a per-user install downloads `orbit-update.json` and its signature from the latest release, checks the signature against the key built into Orbit, and when the feed names a newer version than both the running and the installed one, downloads the setup, checks its size and SHA-256, and runs it with `/VERYSILENT`. Chromium's installer puts the new version next to the running one. Off with `--disable-background-networking`, for system-wide installs, and when the setup's "Keep Orbit up to date automatically" box was cleared (`HKCU\Software\NovaTech\Orbit Update`, `Enabled` = 0).
- **Linux**: apt updates Orbit with the rest of the system from the signed package list.
- **All systems**: Orbit watches the installed version (Chromium does this only for Google Chrome) and, once a newer one is installed, the menu offers to relaunch.
- **macOS**: not yet. A safe self-update needs the Apple signing secrets first.
