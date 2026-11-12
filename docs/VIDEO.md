# Video and audio formats (H.264 and AAC)

Orbit is built with Chromium's default media settings, so it plays VP8, VP9, AV1, Opus, Vorbis,
FLAC and MP3, but not H.264 video or AAC audio. Some sites still serve only H.264 and AAC (older
video players, some news and shopping sites, many MP4 downloads). Orbit must not claim these
formats until one of the options below is built and tested.

Patent terms below come from the licensing body's public pages and are not legal advice. NovaTech
should confirm with the licensors, or a lawyer, before shipping H.264 or AAC.

## Options

| Option | What changes | Patent position | Cost at Orbit's size | Risk |
| --- | --- | --- | --- | --- |
| A. Keep as is | Nothing | No H.264 or AAC code shipped | None | Some sites do not play |
| B. Operating system decoders | Build with `proprietary_codecs = true` but keep Chromium's FFmpeg branding, so MP4 and H.264/AAC parsing are built in and decoding goes to Windows Media Foundation and macOS VideoToolbox / AudioToolbox; Linux uses VA-API hardware where present | Decoding is done by the operating system, which carries its own licenses. Orbit still ships the MP4 parsing code, which needs a licensing check | Likely none, to be confirmed | Chromium's build has a check against this combination that must be relaxed; machines without hardware H.264 decoding (some Linux PCs, virtual machines) still fail; needs testing on each system |
| C. Full software decoders | `proprietary_codecs = true` and `ffmpeg_branding = "Chrome"`, the setup Chrome and most Chromium forks use | Orbit ships H.264 and AAC decoders and needs patent licenses: Via LA's AVC terms list no royalty for the first 100,000 units a year, then $0.20 a unit; AAC is a separate license | H.264 free under 100,000 copies a year; AAC terms to be obtained | Clear legal obligations once distribution grows |

## Recommendation

Option B, if a test build confirms it works: it gives most people H.264 and AAC through their own
operating system without Orbit shipping the decoders. Then option C only if NovaTech obtains the
licenses. Until then, option A stays, and `docs/KNOWN_LIMITS.md` keeps saying so.

The owner decides. Work on B starts only after that decision.

## Sources

- Via LA AVC/H.264 license fees: https://www.via-la.com/licensing-2/avc-h-264/avc-h-264-license-fees
- Chromium audio and video: https://www.chromium.org/audio-video/
- CEF issue on platform decoders without FFmpeg branding: https://github.com/chromiumembedded/cef/issues/3559
- Cromite (a Chromium fork) change using platform decoders: https://github.com/uazo/cromite/pull/856
