![wowza media systems logo](images/wowza-logo.png)
# Wowza Media Systems WebRTC client examples

Welcome to the official Wowza Media Systems Web Real-time Communication (WebRTC) client examples. These examples are intended to help developers bring live streaming into their applications using WebRTC.

This is a **WIP** monorepo that contains multiple browser examples. Each browser example is in its own directory and includes a README with example-specific instructions and additional information. Some browser examples include additional functionality at this time.

- [Examples for FireFox](FireFox/)
- [Examples for Safari](Safari/)
- [Examples for Chrome](Chrome/)

[Adapter.js](https://webrtchacks.github.io/adapter/adapter-latest.js) is a popular shim for creating a cross-browser experience.

## Contents

- [About WebRTC](#AboutWebRTC)
- [Getting Started](#GettingStarted)
- [Resources](#Resources)
- [Contribute](#Contribute)
- [Contact](#Contact)
- [License](#License)


## About WebRTC
WebRTC is an open source project to enable real-time communication of audio, video, and data in web browsers and native apps. WebRTC is designed for peer-to-peer connections but includes fallbacks in case direct connections fail. Encryption is mandatory for WebRTC streams, so you must host the examples on a web server using SSL encryption.

## Getting started
You'll need to setup WebRTC for either Wowza Streaming Engine or Wowza Streaming Cloud to run the examples in this monorepo. The following links include steps for both. 

[Set up WebRTC streaming with Wowza Streaming Engine](https://www.wowza.com/docs/how-to-use-webrtc-with-wowza-streaming-engine)

[Connect a WebRTC stream to Wowza Streaming Cloud](https://www.wowza.com/docs/connect-a-webrtc-stream-to-wowza-streaming-cloud) 

>	**Note:**
>   Keep in mind that encryption is mandatory of WebRTC streams, even for running these examples locally.

### WebRTC meeting example
This monorepo includes a [WebRTC Meeting Example](WebRTCMeeting/). Please see the [README](WebRTCMeeting/README.md) for instructions on how to run the example.

## More resources

[WebRTC workflows in Wowza Streaming Engine](https://www.wowza.com/docs/webrtc-workflows-in-wowza-streaming-engine)


## Contributing

If you feel you have a fix, a better example, or just something to share, make a pull request and it will get reviewed.

## Contact us

Wowza Media Systems™, LLC

Wowza Media Systems provides developers with a platform to create streaming applications and solutions. See the [Wowza Developer Portal](https://www.wowza.com/resources/developers) to learn more about our APIs and SDKs.

## License

This code is distributed under the [BSD 3-Clause License](LICENSE.txt).
