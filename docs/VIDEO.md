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

## Decision

The owner asked for the best option (2026-11-12). Orbit goes with option B, and option C only if
NovaTech obtains the licenses. Until a build with B is tested on each system, option A stays, and
`docs/KNOWN_LIMITS.md` keeps saying so.

## What Orbit does (2026-11-13)

Windows and macOS builds use option B (`orbit-media.patch`, `tools/chromium/args.sh`):

- `proprietary_codecs = true` with Chromium's FFmpeg branding, on Windows and macOS. Chromium's
  FFmpeg already contains the MP4 reader (`CONFIG_MOV_DEMUXER`), but no H.264 or AAC decoder.
- `media_use_openh264 = false`, so no H.264 encoder is compiled into Orbit either (WebRTC's
  software H.264 follows that setting). Encoding uses the operating system's encoders.
- H.264 is decoded by the GPU through Chromium's D3D11 decoder, up to 4096x2304. A Windows PC
  without hardware H.264 decoding (some virtual machines) cannot play it.
- AAC is decoded by Windows Media Foundation through Chromium's existing platform audio decoder
  path (the one Chrome uses for xHE-AAC), fed as ADTS frames. Windows "N" editions need the Media
  Feature Pack.
- macOS: H.264 through VideoToolbox (Chromium's own path), AAC through AudioToolbox in Chromium's
  platform audio decoder (the one Chrome uses for xHE-AAC), extended to all AAC: raw frames with
  the stream's ES descriptor as the magic cookie, the richest layer the stream signals (HE-AAC's
  SBR), and ADTS headers that Media Source adds are removed before decoding.
- `check-browser.mjs` checks that Windows and macOS report MP4 with H.264 and AAC as playable and
  really decode two AAC clips (a plain file and Media Source), and that Linux claims neither.
  Windows CI machines may lack Media Foundation, so there the clip result is only reported.

Linux stays on option A, so it never claims a format it would play without sound.

## What option B needs (research, 2026-11-13)

- Video: Chromium refuses `proprietary_codecs = true` with Chromium's FFmpeg branding through
  an assert in `media/BUILD.gn` ("proprietary codecs and ffmpeg_branding set to Chromium are
  incompatible"). CEF tested that combination with the assert removed (issue 3559, Chromium 117):
  H.264 in MP4 played on Windows 10 and macOS 13 through hardware decoding. Machines without a
  hardware H.264 decoder cannot play it, because no software decoder ships.
- Audio: in the same test, AAC tracks were skipped ("skipping invalid or unsupported audio track"),
  so most MP4 files would play without sound. AAC needs its own work on each system:
  - Windows: Media Foundation has an AAC decoder. Cromite (a Chromium fork) routes AAC to it with
    an `enable_platform_aac_audio` flag and small changes in `ffmpeg_audio_decoder.cc`,
    `media_foundation_audio_decoder.cc` and `mf_helpers.cc` (ADTS framing). Cromite still uses
    Chrome's FFmpeg branding, so this must be redone for Chromium's branding and tested.
  - macOS: no tested way to reach AudioToolbox for AAC from Chromium's media stack was found.
  - Linux: there is no system AAC decoder Chromium can use.
- Order of work: remove the assert and test H.264 video on Windows and macOS; then Windows AAC;
  then decide what to tell people on macOS and Linux. Each step is a full rebuild of media code.

## Sources

- Via LA AVC/H.264 license fees: https://www.via-la.com/licensing-2/avc-h-264/avc-h-264-license-fees
- Chromium audio and video: https://www.chromium.org/audio-video/
- CEF issue on platform decoders without FFmpeg branding: https://github.com/chromiumembedded/cef/issues/3559
- Cromite (a Chromium fork) change using platform decoders: https://github.com/uazo/cromite/pull/856
- Chromium's assert: `media/BUILD.gn` in Chromium 157
