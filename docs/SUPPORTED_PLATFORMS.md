# Supported platforms

Orbit is pre-release, so nothing here is a support promise yet. This table says what actually runs today. "CI" means the full test suite runs on GitHub's machines. A system is only listed as passing after its checks pass.

| System | Architecture | Runs on CI | Package | Notes |
| --- | --- | --- | --- | --- |
| Windows 10 or newer | x64 | windows-2022 | Per-user installer | Also tested by hand on Windows 11 |
| macOS 13 or newer | Apple silicon | macos-15 | Disk image, ad-hoc signed | Not tested on a physical Mac |
| macOS 13 or newer | Intel | macos-15-intel | Disk image, ad-hoc signed | Not tested on a physical Mac |
| Ubuntu 24.04 and similar | x64 | ubuntu-24.04, under Xvfb | .deb and .tar.gz | Needs the setuid sandbox helper, which the .deb sets up |

## Not supported yet

Windows on ARM and Linux on ARM have official CEF builds, but Orbit does not build or test them.

## Linux sandbox

Chromium's sandbox on Linux needs the setuid helper `chrome-sandbox`, owned by root with mode 4755, because Ubuntu 24.04 restricts unprivileged user namespaces. The .deb sets this up. A person running from the .tar.gz must set it themselves:

```sh
sudo chown root:root chrome-sandbox
sudo chmod 4755 chrome-sandbox
```

Orbit never turns the sandbox off to get around this.
