![wowza media systems logo](images/wowza-logo.png)
# Wowza Media Systems WebRTC client examples

Welcome to the official Wowza Media Systems Web Real-time Communication (WebRTC) client examples. These examples cover four streaming scenarios:

- **Publish** — stream video and audio (or screen share) from a browser to Wowza Streaming Engine
- **Play** — play back a live WebRTC stream from Wowza Streaming Engine in a browser

## Contents

- [About WebRTC](#about-webrtc)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Set up WebRTC](#set-up-webrtc)
  - [What's new in v2](#whats-new-in-v2)
  - [Diagnostics in the v2 example](#diagnostics-in-the-v2-example)
  - [Glass-to-glass latency probe](#glass-to-glass-latency-probe)
  - [Combined publisher and player](#combined-publisher-and-player)
  - [Running the tests](#running-the-tests)
  - [Directory Structure](#directory-structure)
  - [Run the example code](#run-the-example-code)
- [Resources](#more-resources)
- [Contact](#contact-us)
- [License](#license)

## About WebRTC
WebRTC is an open source project to enable real-time communication of audio, video, and data in web browsers and native apps. WebRTC is designed for peer-to-peer connections but includes fallbacks in case direct connections fail. Encryption is mandatory for WebRTC streams, so you must host the examples on a web server using SSL encryption.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) v20.19 or later for the v2 React example
- A running [Wowza Streaming Engine](https://www.wowza.com/docs/wowza-streaming-engine-product-articles) instance with WebRTC enabled

### Set up WebRTC
You'll need to set up WebRTC for Wowza Streaming Engine to run the examples. For more information, see [Set up WebRTC streaming with Wowza Streaming Engine](https://www.wowza.com/docs/how-to-use-webrtc-with-wowza-streaming-engine).

### What's new in v2

- **Updated engine WebRTC implementation** — v2 targets the modernized WebRTC implementation introduced in Wowza Streaming Engine 4.11, which includes WHIP/WHEP support, Trickle ICE, HEVC and VP9 codec support, and signaling modernization.
- **Configurable ICE servers** — STUN and TURN servers can now be set from the UI. Multiple servers can be provided as a comma-separated list. Credentials for TURN servers (username and password) are also configurable.
- **SecureToken support** — Wowza Secure Token hash generation is now available in the React example. The token is computed client-side using the Web Crypto API (SHA-256) and sent with the publish/play request. See `v2/src/react-example/src/webrtc/SecureToken.js` for usage notes.
- **Form validation** — Required fields (application name and stream name) are validated before a connection is attempted, surfacing errors early instead of failing silently.
- **Current build toolchain** — v2 builds with [Vite](https://vite.dev/) on React 19, Redux Toolkit and Bootstrap 5.3. `npm install` reports no known vulnerabilities, `npm run build` produces no warnings, and no `--openssl-legacy-provider` workaround is needed. Bootstrap is installed from npm and bundled, and the handful of icons are inline SVG, so the built page loads nothing from a third-party CDN at runtime and waits on no icon font.

### Diagnostics in the v2 example

The publish and play pages each carry two diagnostic tools. The combined page carries both
sets, one per side.

**Connection statistics** sit under the video. `RTT` is measured: it is
`currentRoundTripTime` on the active ICE candidate pair. `Latency` is an **estimate**,
calculated as half the round trip time plus the average jitter buffer delay, and it is
labelled as such on screen. It covers the network leg and the jitter buffer only. It does
**not** include capture, encode, processing inside Wowza Streaming Engine, decode, or the
display pipeline, so true glass-to-glass latency is higher than the figure shown. To
measure the Engine's own contribution instead of estimating around it, use the
[glass-to-glass latency probe](#glass-to-glass-latency-probe) below.

**Server communication** is a collapsible log of the exchange with the Engine: signaling
frames in both directions, the WHIP/WHEP HTTP calls, ICE candidates and peer-connection
state changes. It is collapsed by default, can be filtered by channel, and has a Copy
button for attaching to a support ticket.

### Glass-to-glass latency probe

The connection statistics above estimate the network leg from RTCP counters. The latency
probe measures something different: how long one specific frame took to get from the
publisher's encoder to the player's screen, and how much of that time Wowza Streaming
Engine accounted for.

**It is a diagnostic, not a production metric.** It is off by default, it needs Chromium
and H.264, it installs a per-frame transform at both ends, and it reports nothing at all
when it cannot stand behind the number. Use it to answer "where is the latency going" on a
particular stream on a particular day. Do not put it on a dashboard and do not quote it as
a product specification.

Passthrough only. If the application transcodes, the frame is re-encoded and the marker is
gone, so the player reads "no frame stamp". That is the correct outcome, but it looks like
a broken probe if you are not expecting it.

#### Turning it on

**Both ends need it on.** The publisher writes the marker, the player reads it. A player
with the probe on, watching a stream from a publisher without it, shows "No frame stamp in
this stream" rather than a number.

- **Publish page**, Advanced tab, `Latency Probe (frame stamp)`.
- **Play page**, Advanced tab, the same toggle.
- **Publish + Play page**, the Advanced tab of each side, since that page carries its own
  publisher and player settings.

The Latency group then appears in the **player's** statistics, under the video. There is
nothing to see on the publisher side; the publisher only stamps.

Two things to know:

- **The toggle takes effect on the next connect**, not immediately. The peer connection
  needs `encodedInsertableStreams` set when it is constructed, and the clock data channel
  needs its m-line in the first offer. Toggle it, then connect.
- **The setting travels in the share link.** That is how you set up a two-machine test:
  turn it on, copy the link, open it on the second machine.

#### What the two numbers mean

```
camera -> encode ->| stamp written |-> Engine -> depacketize |<- stamp read ->| decode -> display
       (excluded)          t0                                       t1                      t2
```

| Row | What it covers |
|---|---|
| **Publisher to player** | `t1 - t0`. Publisher packetization, network to the Engine, everything inside the Engine, network to the player, the player's jitter buffer, depacketization. **This is the Engine leg.** |
| **Player decode and display** | `t2 - t1`. Decode, compositing, and the wait until the frame is scheduled for display. |
| **Total** | `t2 - t0`, end to end minus camera capture, the encoder queue and panel emission. See [what the numbers exclude](#what-the-numbers-exclude). |
| **Clock** | Whether the two ends share a clock, and the uncertainty when they do not. See [Clocks](#clocks-and-why-the-testing-mode-matters). |
| **Frames missed** | Gaps in the stamp's sequence number, counted within one simulcast rung. A publisher that stalled shows up here as missed frames instead of as a plausible-looking latency. |

The Engine leg is the row that answers most questions. For reference, on the development
Engine in passthrough it measured a p50 of 107 to 109 ms across three sessions, against a
p50 of 7 ms with the Engine taken out of the path and the same instrument in both arms.
That is a measurement of one Engine on one day, not a specification.

#### Why the number is accurate

The stamp is a sequence number, a millisecond timestamp and a simulcast rung number written
into each encoded frame as an **H.264 SEI NAL** (`user_data_unregistered`, behind a 16-byte
marker UUID), using insertable streams. It is written after the encoder emits the frame and
read before the decoder consumes it.

That placement is the entire point.

- **The marker rides inside the frame.** It passes through packetization, the network, the
  Engine, the jitter buffer and depacketization, which is every stage the picture passes
  through. The interval measured is therefore the interval the picture experienced, not a
  figure assembled from RTCP statistics describing a different part of the pipeline.
- **The encoder cannot corrupt it.** This is what defeats the obvious alternative, drawing
  a timestamp into the pixels. Measured against this repo's own pixel-stamp prototype
  (`v2/src/react-example/src/utils/timecode.js`, kept as a tested codec and unused): 80% of
  frames readable at the source rendition, but only **8.7%** once the encoder was told to
  halve the resolution with `scaleResolutionDownBy: 2`, and 22 of 300 on a simulcast rung.
  Worse than the loss rate, a pixel stamp fabricates confident wrong numbers on the frames
  it does manage to read, because a misread digit is still a digit. Over the same Engine and
  the same sessions the in-frame marker survived **100%** of received frames: 187 of 187,
  248 of 248 and 248 of 248 encoded frames, over both WebSocket play and WHEP.
- **It carries frame identity.** Every frame's stamp has a sequence number, so a gap is
  visible as a gap. An instrument with no frame identity cannot tell a four-second latency
  from a publisher that stopped four seconds ago.
- **It counts gaps per simulcast rung.** A simulcast publisher runs a separate sequence for
  each rung, and the rung travels in the stamp so the player can do the same. This matters
  because the Engine re-originates every rendition under one SSRC: without the rung in the
  stamp the player cannot tell one rung from another, and the switch a joining viewer makes
  from the rung it is handed first to the rung it settles on reads as several hundred lost
  frames. A gap is counted only between consecutive frames of the same rung, so the figure
  means "frames lost while watching one rung without interruption".
- **It joins to the frame that was actually shown.** The player matches a stamp to a
  presented frame on `rtpTimestamp`, which appears both on
  `RTCEncodedVideoFrame.getMetadata()` and in `requestVideoFrameCallback` metadata, so the
  display half of the figure belongs to the same frame as the transport half.
- **It does no harm to the stream.** Injected against a baseline run under the same
  conditions: `framesDropped` 0 in both, `freezeCount` 0 in both, `pliCount` 4 in both,
  same decoder, same resolution, same frame rate.

Two timestamps the transport already offers were tried first and rejected on measurement.
The `abs-capture-time` header extension is stripped by the Engine on all four negotiation
paths (WebSocket publish, WebSocket play, WHIP and WHEP) even when forced into the offer
with `setHeaderExtensionsToNegotiate`. The Engine's RTCP sender-report NTP clock was wrong
by 1.1 to 2.1 seconds against a 100 ms truth, and in one run by 50.5 days for one of two
simultaneous subscribers to the same stream. Neither can carry a timestamp. The SEI marker
needs no Engine-side work at all.

#### What the numbers exclude

Say this alongside any figure you quote from the probe. It is what makes the figure
trustworthy rather than merely small.

- **Camera sensor and ISP delay.** Everything before the browser is handed a frame.
- **The encoder's own queue.** `t0` is taken after the frame comes out of the encoder, so
  time a frame spent waiting to be encoded is invisible here.
- **Photon emission on the panel.** The display end of the measurement is
  `expectedDisplayTime` from `requestVideoFrameCallback`, which is the compositor's
  **prediction** of when the frame will be shown, not an observation that it was.

So the total is end to end minus capture, encode queue and panel. Real glass to glass is
higher, by a bias that is roughly fixed for a given machine and camera. Sizing that bias
takes a one-time calibration with a high frame rate camera (240 fps) pointed at both
screens at once. Until someone does that, quote the probe's number as what it measures and
not as glass to glass.

#### Clocks, and why the testing mode matters

`t0` is taken on the publisher's clock and `t1` on the player's. When those are two
different machines, the difference between their clocks lands directly in the Engine leg,
so the probe has to say how much it trusts them.

| How you are testing | Clock relationship | What the Clock row reads |
|---|---|---|
| One browser, the Publish + Play split view | One clock, one JavaScript context | **exact** |
| Two browsers or two tabs, one machine | The same OS clock, so `Date.now()` agrees to its own resolution | **exact** |
| Two machines | Independent clocks | **estimated**, plus or minus N ms, always shown |

Two browsers on one machine is worth knowing about: it costs nothing to set up, it exercises
two real peer connections in two real processes, and the figure is still exact, because both
processes read the same OS clock.

For two machines the probe estimates the offset over a dedicated `wz-clock` data channel,
NTP style, and keeps the lowest round trip in a rolling window, since the fastest sample
carries the least queuing asymmetry. The uncertainty shown is half that minimum round trip,
which is the bound on how far path asymmetry can have pushed the estimate. It is always
shown, and there is no bare figure in the two-machine case. If the uncertainty is too large,
or the estimate is unstable across the window, the probe shows "clock offset too uncertain
to measure" and **no latency at all**. A confidently wrong number is the failure this
instrument exists to remove.

One weakness of the two-machine mode is worth stating plainly: a route that is consistently
asymmetric, such as an uplink much slower than the downlink on a phone hotspot, produces a
stable and confident offset estimate that is wrong, and no round-trip method can detect
that. On a symmetric LAN path the estimate is sound.

#### Browser and codec support, today

- **Chromium only.** The probe uses `RTCRtpSender.createEncodedStreams()` and its receiver
  twin, which are Chrome specific. The standards path is `RTCRtpScriptTransform` and is a
  follow-up, not implemented here. In a browser without insertable streams the toggle is
  disabled and gives the reason, rather than failing at connect time.
- **H.264 only.** SEI NAL units are an H.264 construct. VP8 and VP9 have no equivalent, so
  there is nowhere to put the marker and prepending one would corrupt the frame. The
  publisher's video codec setting defaults to `auto`, where the Engine chooses from the
  offer, so the codec is not known until the session is up: `auto` leaves the toggle
  enabled, and if the negotiated codec turns out not to be H.264 the player reports "no
  frame stamp" instead of a number. Selecting an explicit non-H.264 codec disables the
  toggle with the reason.

### Combined publisher and player

`Publish + Play` runs a publisher and a player side by side against the same Engine, each
with its own settings and its own statistics. The two are independent peer connections, so
their figures are per side and do not sum to a round-trip measurement.

### Running the tests

```bash
cd v2/src/react-example
npm test          # unit tests (Vitest)
npm run test:e2e  # end-to-end tests (Playwright)
```

The end-to-end suite drives a real browser. It uses Chromium's fake capture device, so no
webcam is needed, and it talks to a real Wowza Streaming Engine. Point it at yours with:

```bash
# macOS / Linux
export WOWZA_SIGNALING_URL=wss://your-engine/webrtc-session.json
export WOWZA_APPLICATION=webrtc
```

```cmd
:: Windows (cmd)
set WOWZA_SIGNALING_URL=wss://your-engine/webrtc-session.json
set WOWZA_APPLICATION=webrtc
```

Tests that need an Engine skip themselves when one is not reachable, so the suite is still
useful without a server. It covers publish and play over both signalling paths, WHIP ingest and WHEP egress, the chat and captions data channels, the header status, the diagnostics panel and the stats graphs.

### Directory structure

The examples are organized into two versions:

#### v2

- `v2/src/react-example` — React example with the latest features and fixes
    - `v2/src/react-example/src/components` — React components for the publish, play, meeting, and composite examples
        - `composite` — Components for compositing a WebRTC stream with multiple video and audio tracks
        - `meeting` — Components for publishing a WebRTC stream with multiple participants
        - `play` — Components for playing back a WebRTC stream
        - `publish` — Components for publishing a WebRTC stream
    - `v2/src/react-example/src/hooks`
        - `useMediaStream.js` — Custom hook for managing the active media stream ref
    - `v2/src/react-example/src/webrtc` — JavaScript files for managing the WebRTC setup
        - `SecureToken.js` — Builds a secure token hash
        - `getDevices.js`, `getUserMedia.js`, `getDisplayScreen.js` — Media device helpers
        - `replaceAudioTrack.js`, `replaceVideoTrack.js` — Track replacement utilities
        - `startPlay.js`, `stopPlay.js`, `startPublish.js`, `stopPublish.js` — Stream lifecycle helpers
    - `v2/src/react-example/src/utils` — Utility functions
        - `IceServersUtils.js` — Validation and configuration helpers for STUN/TURN ICE servers
        - `ValidationUtils.js` — Form validation utilities
        - `CookieUtils.js` — Cookie read/write helpers
    - `v2/src/react-example/src/actions`, `v2/src/react-example/src/reducers` — Redux state management

#### v1 (legacy)

- `v1/src/jquery-example` — Vanilla JavaScript/jQuery example
    - `css` and `images` — Assets used by the example HTML pages
    - `lib` — JavaScript files for managing the WebRTC setup
        - `AvMenu.js` — Controls the selected input for publishing and screen sharing
        - `SecureToken.js` — Builds a secure token hash
        - `Settings.js` — Creates a set of configuration settings and copy functionality
        - `SoundMeter.js` — Provides an audio meter
        - `WowzaMungeSDP.js` — Utilities for modifying SDP
        - `WowzaPeerConnectionPlay.js` — Manages the signaling process for playback
        - `WowzaPeerConnectionPublish.js` — Manages the signaling process for publishing
        - `WowzaWebRTCAPI.js` — Core WebRTC API wrapper
        - `WowzaWebRTCPlay.js` — Controls the playback state
        - `WowzaWebRTCPublish.js` — Controls the publishing state
    - `dev-view-publish.html` — Example page for publishing a WebRTC stream with video, audio, and screen share
    - `dev-view-play.html` — Example page for playing back a WebRTC stream
    - `dev-view-chat.html` — Example page for a WebRTC chat session
    - `play.js` and `publish.js` — JavaScript files for controlling the WebRTC setup
- `v1/src/react-example` — React example (Redux-based)
    - `src/components` — React components for the publish, play, meeting, and composite examples
    - `src/webrtc` — JavaScript files for managing the WebRTC setup
    - `src/actions`, `src/reducers` — Redux state management

### Run the example code

>	**Note:**
>   If you're not running the examples from `localhost`, an HTTPS connection is required for WebRTC to access local devices.

#### v2 React example (recommended)

```bash
cd v2/src/react-example
npm install
npm start
```

Go to `localhost:3000` to view the example.

#### v1 React example

```bash
cd v1/src/react-example
npm install
npm start
```

Go to `localhost:3000` to view the example.

#### v1 jQuery example

```bash
cd v1/src/jquery-example
npx serve
```

Go to `localhost:3000` to view the examples.

## More resources

- [WebRTC workflows in Wowza Streaming Engine](https://www.wowza.com/docs/webrtc-workflows-in-wowza-streaming-engine)

## Contact us

Wowza Media Systems™, LLC

Wowza Media Systems provides developers with a platform to create streaming applications and solutions. See the [Wowza Developer Portal](https://www.wowza.com/resources/developers) to learn more about our APIs and SDKs.

## License

This code is distributed under the [BSD 3-Clause License](LICENSE.txt).
