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
node tools/chromium/window-shots.mjs <chrome.exe> <out folder> en dark,light
```

`window-shots.mjs` captures Orbit's own windows on Windows for design review.

## Chromium updates

The Chromium version is pinned in `.github/workflows/chromium-stage.yml` (`CHROMIUM_VERSION`). To update it, change the version, run the patch series against the new source, and fix any patch that no longer applies. Security fixes should ship within days. **Automatic watching for new versions is not built.**

## Filter list updates

`.github/workflows/filters-update.yml` runs weekly and opens a pull request with new rules in `filters/rules`. It refuses a list that looks truncated. Check the rule counts in `filters/rules/meta.json` for a large unexplained drop, then merge when CI passes.

## Packaging, signing and release

**Not built.** These need decisions and accounts from the owner:

| Step | What it needs |
| --- | --- |
| Installers | Packaging the built browser for each system |
| Windows signing | A SignPath Foundation application, which is open to open source projects |
| macOS signing and notarization | A Developer ID certificate and an App Store Connect API key from the existing Apple membership, stored as GitHub secrets |
| Public downloads | Approval to publish GitHub Releases |
| Automatic updates | Signed update feeds and public hosting for them |
