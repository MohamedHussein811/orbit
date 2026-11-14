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

The Chromium version is pinned in `.github/workflows/chromium-stage.yml` (`CHROMIUM_VERSION`). To update it, change the version, run the patch series against the new source, and fix any patch that no longer applies. Security fixes should ship within days. **Automatic watching for new versions is not built.**

## Filter list updates

`.github/workflows/filters-update.yml` runs weekly and opens a pull request with new rules in `filters/rules`. It refuses a list that looks truncated. Check the rule counts in `filters/rules/meta.json` for a large unexplained drop, then merge when CI passes.

## Packaging, signing and release

The last build stage runs `tools/chromium/package.sh` after the browser check and keeps the result as the `orbit-package-<system>` artifact for 30 days:

| System | Package | Notes |
| --- | --- | --- |
| Windows | `OrbitSetup-<version>-x64.exe` | Chromium's installer (`mini_installer`). Installs for the current user into `%LOCALAPPDATA%NovaTechOrbit`, no administrator rights. Not code-signed yet |
| macOS | `Orbit-<version>-mac-arm64.dmg` | Signed with Chromium's `sign_chrome.py` and notarized when the signing secrets below are set; otherwise `-unsigned.dmg` |
| Linux | `orbit_<version>_amd64.deb`, `Orbit-<version>-linux-x64.tar.xz` | Installs to `/opt/novatech/orbit` with `/usr/bin/orbit`, a desktop entry and icons |

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

Windows signing needs a SignPath Foundation application (free for open source projects); it is not set up.

### Publishing a release

Run the **Release** workflow by hand with a tag (`vX.Y.Z`) and the run ids of green Windows, Mac and Linux builds of the same commit. It downloads their packages, runs `tools/release-files.mjs` and publishes a GitHub Release with:

- the installers and Linux packages,
- `orbit-extension.crx` and `orbit-extension-updates.xml`: the built-in extension's `update_url` points at `releases/latest/download/orbit-extension-updates.xml`, so installed copies get new Shields rules from each release without reinstalling. Updates must be signed with the same extension key (`ORBIT_EXTENSION_KEY`), and the extension version is the commit count, so it always increases,
- `latest.json`: the browser checks it once a day (Settings: Orbit privacy page, "Orbit updates", on by default) and shows a note on the new tab page when a release carries a newer browser,
- `SHA256SUMS.txt` for every file.

The browser itself does not update in place yet: people install the new release over the old one.
