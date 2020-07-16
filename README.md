![wowza media systems logo](images/wowza-logo.png)
# Wowza Media Systems WebRTC client examples

Welcome to the official Wowza Media Systems Web Real-time Communication (WebRTC) client examples. These examples are intended to help developers bring live streaming into their applications using WebRTC.

## Contents

- [About WebRTC](#about-webrtc)
- [Getting Started](#getting-started)
  - [Set up WebRTC](#set-up-webrtc)
  - [Directory Structure](#directory-structure)
  - [Run the example code](#run-the-example-code)
- [Resources](#more-resources)
- [Contact](#contact-us)
- [License](#license)

## About WebRTC
WebRTC is an open source project to enable real-time communication of audio, video, and data in web browsers and native apps. WebRTC is designed for peer-to-peer connections but includes fallbacks in case direct connections fail. Encryption is mandatory for WebRTC streams, so you must host the examples on a web server using SSL encryption.

## Getting started

### Set up WebRTC
You'll need to setup WebRTC for either Wowza Streaming Engine or Wowza Streaming Cloud to run the examples in this repo. The following links include steps for both. 

[Set up WebRTC streaming with Wowza Streaming Engine](https://www.wowza.com/docs/how-to-use-webrtc-with-wowza-streaming-engine)

[Connect a WebRTC stream to Wowza Streaming Cloud](https://www.wowza.com/docs/connect-a-webrtc-stream-to-wowza-streaming-cloud) 

>	**Note:**
>   Keep in mind that encryption is mandatory for WebRTC streams.

### Directory structure

In the `src` folder, you'll find the following:
- `css` and `images` - Assets used by the example HTML pages.
- `lib` - JavaScript libraries for managing the WebRTC setup.
   - `AvMenu.js` - Controls the selected input for publishing and screen sharing.
   - `Settings.js` - Creates a set of configuration settings and copy functionality.
   - `SoundMeter.js` - Provides a audio meter.
   - `WowzaMungeSDP.js` - Generates an SPD for peer signaling.
   - `WowzaPeerConnectionPlay.js` - Manages the signaling process for playback.
   - `WowzaPeerConnectionPublish.js` - Manages the signaling process for publishing.
   - `WowzaWebRTCPlay.js` - Controls the playback state.
   - `WowzaWebRTCPublish.js` - Controls the publishing state.
- `dev-view-publish.html` - Example HTML page that can create a WebRTC stream with video, audio, and screen share input and publish it to Wowza Streaming Engine. 
- `dev-view-play.html` - Example HTML page that can play back a WebRTC stream from Wowza Streaming Engine.
- `play.js` and `publish.js` - JavaScript files that use libraries imported from the `lib` folder to control the WebRTC setup for publishing and playing streams.




### Run the example code

To run on your local host, in the project directory execute:
```bash
 $ npx serve
 ```

Go to `localhost:5000/src/` to view the examples.

If you are not running the examples from `localhost`, an HTTPS connection is required for WebRTC to access local devices.

## More resources

[WebRTC workflows in Wowza Streaming Engine](https://www.wowza.com/docs/webrtc-workflows-in-wowza-streaming-engine)


## Contact us

Wowza Media Systems™, LLC

Wowza Media Systems provides developers with a platform to create streaming applications and solutions. See the [Wowza Developer Portal](https://www.wowza.com/resources/developers) to learn more about our APIs and SDKs.

## License

This code is distributed under the [BSD 3-Clause License](LICENSE.txt).