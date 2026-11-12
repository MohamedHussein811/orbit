# Supported platforms

Orbit is pre-release, so nothing here is a support promise yet. This table says what is built and checked today. "CI" means GitHub's machines build Orbit and run the browser checks.

| System | Architecture | Built on CI | Notes |
| --- | --- | --- | --- |
| Windows 10 or newer | x64 | windows-2025, Visual Studio 2026 | Also run by hand on Windows 11 |
| macOS | Apple silicon | xcode-27 image | Needs the macOS 27 SDK. Not tested on a physical Mac |
| Linux | x64 | ubuntu | Not tested on a physical machine |

## Not supported yet

Intel Macs, Windows on ARM and Linux on ARM are not built or tested.

## Linux sandbox

Chromium's sandbox on Linux needs the setuid helper `chrome-sandbox`, owned by root with mode 4755, where unprivileged user namespaces are restricted (Ubuntu 24.04 and newer):

```sh
sudo chown root:root chrome-sandbox
sudo chmod 4755 chrome-sandbox
```

Orbit never turns the sandbox off to get around this.
