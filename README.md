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
calculated as half the round trip time plus the jitter buffer delay over the last second, and it is
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
