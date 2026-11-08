# Orbit

Orbit is a free, privacy-focused desktop browser by NovaTech, built on the Chromium Embedded Framework (CEF). It has no ads, no analytics and no AI features.

**Status: early development. There is no release yet, and Orbit is not ready for everyday use.**

## What exists today

- A native host that opens Chromium's full tabbed browser through CEF, with Chromium's sandbox and site isolation left on.
- Privacy defaults applied once per profile: DuckDuckGo search, third-party cookies blocked, HTTPS-only mode, DNS over HTTPS through Quad9, reporting and prediction off.
- Web APIs for AI and advertising switched off.
- Session restore after a clean exit and after a crash, with a guard against crash loops.
- A pinned engine with SHA-256 checks, and a daily job that proposes an update when CEF ships a newer stable build.

The automated tests in [`tests/host`](tests/host) define what counts as working. CI runs them on each system listed in [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

## Known limits

- **Video:** official CEF binaries have no H.264, AAC or HEVC. Sites that need those formats fail. YouTube plays through VP9. This is an open release blocker.
- **Safe Browsing:** not available in this engine build. A replacement threat feed is planned and not built.
- **Not built yet:** the dashboard, ad and tracker blocking, themes, updater, installers and signed packages.

## Build

You need Node.js 22 or newer, CMake, Ninja and a C++ toolchain (Visual Studio 2022 on Windows, Xcode on macOS, GCC or Clang on Linux).

```sh
node tools/engine.mjs fetch      # download and verify the pinned CEF
node tools/build-host.mjs        # build the orbit and orbit_test variants
```

On Windows the build goes to `%LOCALAPPDATA%\NovaTech\orbit-build`. Elsewhere it goes to `out/host`. Set `ORBIT_BUILD_DIR` to change it.

## Test

```sh
node --test --test-concurrency=1 tests/host/host.test.mjs
```

Tests start `orbit_test` on a temporary profile. That build refuses to run without `ORBIT_USER_DATA_DIR`, so it cannot touch a real profile.

## Layout

| Path | Contents |
| --- | --- |
| `host/` | Native host. The only code that names CEF |
| `engine/engine.json` | Pinned CEF version and hashes |
| `tools/` | Engine and build scripts |
| `tests/host/` | End-to-end tests of the built host |

## Security

See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

Orbit's own code is under the [Mozilla Public License 2.0](LICENSE). Third-party licenses are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
