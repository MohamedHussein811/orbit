# Threat model

No browser is fully secure, and no browser makes a person impossible to track. This document says what Orbit defends against, how, and where the defence stops.

## What Orbit protects

- A person's browsing activity, from advertisers, trackers and websites.
- A person's accounts and saved passwords, from malicious sites and local file readers.
- The integrity of the browser and its updates.

## Who Orbit defends against

| Adversary | Defence | Limit |
| --- | --- | --- |
| Advertising and tracking networks | Rule-based blocking, third-party cookies blocked by default | Lists miss new domains. First-party tracking is not blocked |
| Fingerprinting scripts | Per-site values for canvas, audio and graphics, rounded hardware details | Fonts, screen size and many other signals remain at the standard level. Canvases in workers are not covered |
| Malicious websites | Chromium's sandbox and site isolation, HTTPS-only mode | Depends on prompt engine updates |
| Network attackers | HTTPS-only mode, DNS over HTTPS, certificate checks, CRLSet | Certificate Transparency is reported but enforcement is unproven. Key pinning is off in this engine build |
| Phishing and malware sites | Threat lists with a warning page (Orbit's Safe Browsing choice, on by default) | Lists update with Orbit, so they lag. Google Safe Browsing is not available, and this is weaker |
| A hijacked update server | Signed updates are planned | Not built yet. See KNOWN_LIMITS.md |
| Other programs run by the same person | Passwords use the operating system's key store | Malware running as that person can still read much of their data. Orbit does not defend against this |

## Out of scope

- Governments or network operators with control of a certificate authority trusted by the system.
- Attackers with physical access to an unlocked device.
- Bugs in Chromium before a fix is released. Orbit's job is to ship fixes quickly.

## What Orbit itself must not do

Each of these has a reason it cannot happen, or says that it is not checked on the Chromium fork yet:

| Rule | Check |
| --- | --- |
| No analytics, ads or accounts | No such code exists. Reporting preferences are off |
| No record of blocked addresses | Shields stores daily counts only, never addresses (`extension/src/shared/stats.ts`) |
| No traffic to the weather service before a city is set | The new tab page fetches weather only after a city is saved (`extension/src/newtab/widgets.ts`) |
| Private window choices are not saved | Not checked on the fork yet |
| The sandbox stays on | Orbit does not change Chromium's sandbox code. Not checked on each system yet |
| A switch cannot weaken the release build | Not true yet: like Chromium, the fork accepts command-line switches. Not checked |

## Known network traffic

These leave a device with Orbit idle. The feasibility report has the measurements.

- `update.googleapis.com` and `edgedl.me.gvt1.com`: the engine's component updates, which carry revocation data. Turning them off also loses revocation, so Orbit keeps them. The check tells Google which component versions are installed.
- `github.com` and GitHub's download host: on Windows, Orbit's updater fetches the signed release feed every few hours (no cookies); the built-in extension checks for new Shields rules daily; the new tab page reads `latest.json` daily. On Linux, apt fetches Orbit's package list with the system's updates.

## Update integrity

| Threat | Defense |
| --- | --- |
| A tampered or swapped Windows update | The feed must carry a valid Ed25519 signature from Orbit's release key, which is built into the browser; the setup must match the feed's size and SHA-256 and come from the project's GitHub releases. A compromised GitHub account alone cannot sign a feed |
| A tampered Linux package | apt checks the package list's OpenPGP signature against the key the package installed, and each package against the list's SHA-256 |
| A stolen release key | Not defended beyond keeping it in repository secrets. Replacing it needs a release signed with the old key |
| An older feed replayed to stop updates | Orbit never installs a version lower than or equal to the running or installed one, but a replayed old feed can delay updates |

Default search goes to DuckDuckGo and secure DNS to Quad9, both of which a person can change.

## Reporting

See [SECURITY.md](../SECURITY.md).
