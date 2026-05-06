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
  - [Directory Structure](#directory-structure)
  - [Run the example code](#run-the-example-code)
- [Resources](#more-resources)
- [Contact](#contact-us)
- [License](#license)

## About WebRTC
WebRTC is an open source project to enable real-time communication of audio, video, and data in web browsers and native apps. WebRTC is designed for peer-to-peer connections but includes fallbacks in case direct connections fail. Encryption is mandatory for WebRTC streams, so you must host the examples on a web server using SSL encryption.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) v16 or later
- A running [Wowza Streaming Engine](https://www.wowza.com/docs/wowza-streaming-engine-product-articles) instance with WebRTC enabled

### Set up WebRTC
You'll need to set up WebRTC for Wowza Streaming Engine to run the examples. For more information, see [Set up WebRTC streaming with Wowza Streaming Engine](https://www.wowza.com/docs/how-to-use-webrtc-with-wowza-streaming-engine).

### What's new in v2

- **Updated engine WebRTC implementation** — v2 targets the modernized WebRTC implementation introduced in Wowza Streaming Engine 4.11, which includes WHIP/WHEP support, Trickle ICE, HEVC and VP9 codec support, and signaling modernization.
- **Configurable ICE servers** — STUN and TURN servers can now be set from the UI. Multiple servers can be provided as a comma-separated list. Credentials for TURN servers (username and password) are also configurable.
- **SecureToken support** — Wowza Secure Token hash generation is now available in the React example. The token is computed client-side using the Web Crypto API (SHA-256) and sent with the publish/play request. See `v2/src/react-example/src/webrtc/SecureToken.js` for usage notes.
- **Form validation** — Required fields (application name and stream name) are validated before a connection is attempted, surfacing errors early instead of failing silently.

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
