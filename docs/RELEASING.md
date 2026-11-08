# Building and releasing

This describes the process as it stands. Steps marked "not built" do not exist yet.

## Build

```sh
npm ci                      # type checker only. The build itself has no npm dependencies
node tools/engine.mjs fetch # download and verify the pinned CEF
node tools/build-host.mjs   # build orbit and orbit_test, then the extension
```

## Test

```sh
npm run typecheck
npm run test:unit
node --test --test-concurrency=1 tests/host/host.test.mjs tests/host/extension.test.mjs
```

`tests/package/install-smoke.mjs` installs system-wide and only runs on CI.

## Package

```sh
node tools/package.mjs
```

Output goes to `out/package`, with `SHA256SUMS.txt`. Windows needs Inno Setup 7. Set `ORBIT_ISCC` if it is not in a standard folder.

## Engine updates

`.github/workflows/engine-watch.yml` runs daily. When CEF publishes a newer stable build, it opens a pull request that changes `engine/engine.json`, and starts CI on it. Read the Chromium release notes, then merge when CI passes. Security fixes should ship within days.

To update by hand: `node tools/engine.mjs check`, then `node tools/engine.mjs pin`.

If the engine update changes Chromium's logos, the build stops with a message about `branding/engine-logos.json`. Find the new logo hashes through `chrome://theme/current-channel-logo` and `chrome://theme/IDR_PRODUCT_LOGO`.

## Filter list updates

`.github/workflows/filters-update.yml` runs weekly and opens a pull request with new rules in `filters/rules`. It refuses a list that looks truncated. Check the rule counts in `filters/rules/meta.json` for a large unexplained drop, then merge when CI passes.

## Signing and release

**Not built.** These need decisions and accounts from the owner:

| Step | What it needs |
| --- | --- |
| Windows signing | A SignPath Foundation application, which is open to open source projects |
| macOS signing and notarization | A Developer ID certificate and an App Store Connect API key from the existing Apple membership, stored as GitHub secrets |
| Public downloads | Approval to publish GitHub Releases |
| Automatic updates | An EdDSA key pair kept offline, and public hosting for the update feed |

`tools/package.mjs` reads `ORBIT_MAC_IDENTITY` for signing. With no identity it applies an ad-hoc signature, which only works on the machine that made it or after a person overrides Gatekeeper.
