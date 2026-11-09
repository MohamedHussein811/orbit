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
| Phishing and malware sites | Threat lists with a warning page | Lists update with Orbit, so they lag. Google Safe Browsing is not available, and this is weaker |
| A hijacked update server | Signed updates are planned | Not built yet. See KNOWN_LIMITS.md |
| Other programs run by the same person | Passwords use the operating system's key store | Malware running as that person can still read much of their data. Orbit does not defend against this |

## Out of scope

- Governments or network operators with control of a certificate authority trusted by the system.
- Attackers with physical access to an unlocked device.
- Bugs in Chromium before a fix is released. Orbit's job is to ship fixes quickly.

## What Orbit itself must not do

Each of these has a test, or a reason it cannot happen:

| Rule | Check |
| --- | --- |
| No analytics, ads or accounts | No such code exists. Reporting preferences are off |
| No record of blocked addresses | A test searches stored data for blocked hosts |
| No traffic to the weather service before a city is set | A test checks the dashboard's network entries |
| Private window choices are not saved | A test checks that a private window's site switch stays out of the profile |
| Websites cannot reach the host | A test calls the host API from a website |
| The sandbox stays on | The build fails without it on Windows. Tests read the sandbox state on each system |
| A switch cannot weaken the release build | A test passes `--no-sandbox` and `--disable-web-security`, and checks child processes |

## Known network traffic

These leave a device with Orbit idle. The feasibility report has the measurements.

- `update.googleapis.com` and `edgedl.me.gvt1.com`: the engine's component updates, which carry revocation data. Turning them off also loses revocation, so Orbit keeps them. The check tells Google which component versions are installed.

Default search goes to DuckDuckGo and secure DNS to Quad9, both of which a person can change.

## Reporting

See [SECURITY.md](../SECURITY.md).
