# Performance

Run `node tests/perf/bench.mjs` on a built host. Numbers vary by machine, so compare runs on one machine only. No test fails on these numbers yet.

## What it measures

| Measure | Method |
| --- | --- |
| Start to dashboard | From process start to the dashboard being drawn, on an existing profile, median of 5. The files are in the system's cache, so this is a warm start |
| Memory | Working set summed across all of Orbit's processes. Shared memory counts more than once, so the true figure is lower |
| Idle CPU | Processor time over 30 seconds on the dashboard, with no DevTools client attached, starting 15 seconds after launch |
| Tab switch | Time for a page to report back after being brought to the front, median of 10 tabs |
| Open and load a tab | New tab loading a small local page, median of 5 |

## Latest results

Windows 11, Intel Core i5-12450H, 8 GB RAM, 2026-11-09, build 0.1.0.

| Measure | Result |
| --- | --- |
| Start to dashboard | 738 ms |
| Memory, dashboard only | 472 MB across 7 processes |
| Memory, 10 small tabs | 1,136 MB across 17 processes |
| Idle CPU on the dashboard | 4 to 7% of one core |
| Tab switch | 27 ms |
| Open and load a tab | 150 ms |

## Idle CPU notes

Idle use changes with what the window shows. In one run with nothing attached, the dashboard used 5.7% of one core, a blank page with the address bar focused used 4.3%, and a plain local page used 1.7%. Removing the dashboard's animation, blur or background one at a time changed little, so no single effect is the cause. A blinking cursor in the address bar likely explains part of this, which is unproven.

## Compared with Chrome

One run each on the same machine, measured the same way on a fresh profile, 20 seconds after launch and over 30 seconds, on each browser's new tab page. One run is not enough to call either better.

| Browser | Processes | Memory | Idle CPU, % of one core |
| --- | --- | --- | --- |
| Orbit 0.1.0 (Chromium 156) | 7 | 476 MB | 3.1 |
| Chrome 157 | 9 | 607 MB | 5.1 |

## Real websites

`node tests/perf/sites.mjs` visits sites one at a time with Shields on, signed out. Sites change, so this is a manual check and not part of CI. Run on 2026-11-09, 37 ads and 124 trackers were blocked across all 12 sites.

| Site | Load seconds | Result |
| --- | --- | --- |
| Wikipedia | 1.0 | Loaded |
| GitHub | 2.1 | Loaded |
| YouTube | 3.0 | Loaded, video played |
| Reddit | 4.8 | Loaded, 3 script errors on the page |
| X | 1.6 | Loaded the signed-out page |
| BBC | 2.8 | Loaded |
| CNN | 5.7 | Loaded, 2 script errors on the page |
| Amazon | 0.9 | Loaded |
| Stack Overflow | 0.8 | Loaded |
| Google Maps | 2.7 | Loaded |
| Vimeo | 5.5 | Loaded, video did not play, a known H.264 limit |
| Twitch | 6.2 | Loaded, video did not play, a known H.264 limit |

Script errors may come from blocked trackers, and this run did not compare them with Shields off. Sites were only loaded, not used.

## Not measured yet

Long sessions, memory growth over time, and macOS and Linux.
