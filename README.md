# Orbit

Orbit is a free, privacy-focused desktop browser by NovaTech, built as a fork of Chromium. It has no ads, no analytics and no AI features.

**Status: early development. There is no release yet, and Orbit is not ready for everyday use.**

## What exists today

- Chromium 157 built from Google's source archive with Orbit's changes on top (`chromium/`), on GitHub's free runners for Windows, macOS and Linux.
- Orbit's name, logo, color palette, pill-shaped tabs and toolbar icons, and `orbit://` addresses for internal pages.
- Privacy defaults: DuckDuckGo search, secure DNS through Quad9, HTTPS-only mode, no prediction, translation or sign-in, AI and advertising web APIs off.
- A built-in extension with the new tab page (black hole video or the person's own background, search, shortcuts, protection counts, weather, notes) and Shields, which blocks ads, trackers and listed threats with Chromium's own rule engine.
- A privacy page for fingerprinting protection levels, WebRTC handling, clearing data at startup and history cleanup.

## Known limits

- **Video:** no H.264, AAC or HEVC yet. The plan is in [docs/VIDEO.md](docs/VIDEO.md).
- **Not built yet:** installers, signing and automatic updates.
- More in [docs/KNOWN_LIMITS.md](docs/KNOWN_LIMITS.md).

## Build

Chromium is too large to compile on a typical PC, so it builds on CI in chained stages (`.github/workflows/browser-*.yml`). How the changes are applied is described in [chromium/README.md](chromium/README.md), the design in [chromium/DESIGN.md](chromium/DESIGN.md).

## Test

```sh
npm ci
npm run typecheck
npm run test:unit
node tools/chromium/check-browser.mjs <path to a built Orbit> kceipbaiojomdibnboffoieecidpfdck
```

`check-browser.mjs` starts the built browser on a temporary profile and checks its defaults, the built-in extension and the new tab page through the DevTools protocol. CI runs it after each build.

## Layout

| Path | Contents |
| --- | --- |
| `chromium/` | Orbit's Chromium changes: overlay files, patches, design system |
| `extension/` | Built-in extension: new tab page, Shields, privacy page |
| `filters/` | Filter list sources and the compiled blocking rules |
| `branding/` | The logo and its icon sizes |
| `tools/` | Build, filter, design and check scripts |
| `tests/` | Unit tests for the tools |

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

Orbit's own code is under the [Mozilla Public License 2.0](LICENSE). Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
