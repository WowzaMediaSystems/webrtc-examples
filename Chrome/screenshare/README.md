![wowza media systems logo](../../images/wowza-logo.png)
# Wowza Media Systems WebRTC client examples for screen sharing

Welcome to the official Wowza Media Systems WebRTC client examples. These examples are intended to help developers bring live streaming into their applications using WebRTC.

## Contents

- [Share](share/) The HTML, image, and Javascript files required for this example.

>	**Important:**
>	* This example has been tested using Google Chrome and Wowza Streaming Engine.
>
>	* You must already have WebRTC configured and working with the basic examples provided. See [Set up WebRTC streaming with Wowza Streaming Engine](https://www.wowza.com/docs/how-to-use-webrtc-with-wowza-streaming-engine) for instructions on configuring WebRTC streaming with Wowza Streaming Engine.
>
>	* Encryption is mandatory for WebRTC streams, even when running these examples locally.

## Install the required Chrome Extension

An extension is required to provide access to the screen share capability. An open source extension can be found here

[Screen Share Extension](https://chrome.google.com/webstore/detail/screen-capturing/ajhifddimkapgcifgcodmmfdlknahffk)

It provides a basic media ID which can then be used to attach to a peer connection.

## Install the Share example

- Copy the share/ folder to your installation

- Open the example in your browser and it should now show an option to share your screen using the following example style link

https://&lt;Your Stream Lock&gt;.streamlock.net/webrtc/share/

- You can then publish your screen 

- Play back is the same as any other WebRTC stream
