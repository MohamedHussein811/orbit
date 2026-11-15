# Orbit

Orbit is a free, privacy-focused desktop browser by NovaTech, built as a fork of Chromium. It has no ads, no analytics and no AI features.

**Status: early releases.** Download Orbit for Windows, macOS and Linux from [Releases](https://github.com/MohamedHussein811/orbit/releases/latest). It is young software: read [docs/KNOWN_LIMITS.md](docs/KNOWN_LIMITS.md) first.

## What exists today

- Chromium 157 built from Google's source archive with Orbit's changes on top (`chromium/`), on GitHub's free runners for Windows, macOS and Linux.
- Orbit's name, logo, color palette, pill-shaped tabs and toolbar icons, and `orbit://` addresses for internal pages.
- Privacy defaults: DuckDuckGo search, secure DNS through Quad9, HTTPS-only mode, no prediction, translation or sign-in, AI and advertising web APIs off, no background apps after the last window closes.
- A built-in extension with the new tab page (black hole video, Orbit Gallery videos by category, the person's own background or a color, search with a choice of engine, favorite or frequently visited sites, protection counts, weather, notes) and Shields, which blocks ads, trackers and listed threats with Chromium's own rule engine, removes YouTube's video ads, and lists what it blocked on each page.
- A privacy page for fingerprinting protection levels, WebRTC handling, clearing data at startup and history cleanup.

## Updates

- **Windows:** Orbit checks its releases on GitHub every few hours and installs a newer version in the background; the menu then offers to relaunch. The update feed is signed with Orbit's own key, and each download is checked against it before it runs. Setup has a choice to turn this off.
- **Linux (.deb):** the package adds Orbit's signed package list to apt, so the system's updates keep Orbit current.
- **macOS:** not yet; the new tab page says when a release is out.
- New Chromium releases are checked weekly, and Orbit moves to them when its changes still apply.

## Known limits

- **Video:** H.264 and AAC play through the operating system on Windows and macOS, not on Linux. Details in [docs/VIDEO.md](docs/VIDEO.md).
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

See [SECURITY.md](SECURITY.md) to report a vulnerability. What Orbit sends and where is in [PRIVACY.md](PRIVACY.md).

## Code signing policy

Orbit's Windows setup is built by GitHub Actions from this repository and signed in the release workflow (`.github/workflows/release.yml`). Every signing request is approved by hand.

Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org). The application is in progress: until it is approved, the Windows setup is not signed and the release notes say so.

- Committers and reviewers: [MohamedHussein811](https://github.com/MohamedHussein811)
- Approvers: [MohamedHussein811](https://github.com/MohamedHussein811)

Privacy: Orbit does not send information to other networked systems except as described in [PRIVACY.md](PRIVACY.md): update checks, and services a person turns on or asks for.

## License

Orbit's own code is under the [Mozilla Public License 2.0](LICENSE). Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
