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

An extension is required to provide access to the screen share capability. An open source extension can be found here:

[Screen Share Extension](https://chrome.google.com/webstore/detail/screen-capturing/ajhifddimkapgcifgcodmmfdlknahffk)

It provides a basic media ID which can then be used to attach to a peer connection.

Please keep in mind this Chrome Extension is not built or maintained by Wowza Media Systems and is just an example of how a screen share capabality can be added to a WebRTC workflow.

## Install the Share example

Copy the `share/` folder to your installation. `install-dir/conf/webrtc`

Open the example in your browser at and it should now show an option to share your screen. Make a window selection and click `Share`.

![Screen Share Browser Extension Model when example starts](images/screen_share.png)

In this example, you will not see a preview of what you are sharing, but you will see a small banner from your browser extension alerting you to what is being shared.

Using your domain name, replace `localhost` with your domain name. For example, using a StreamLock domain, it should look like the following:

`wss://123456.streamlock.net/webrtc-session.json`

If you hit publish before configuring your SDP URL, you will need to refresh the page.

You can then publish your screen using the `Publish` button.

Playback is the same as any other WebRTC stream. Use the one in Chrome examples by navigating to the `index.html` page in the `Play` directory or at the following URL:

`https://[ssl-certificate-domain-name]:9443/webrtc/play/index.html`

For StreamLock, use the following URL as an example:

`https://123456.streamlock.net:9443/webrtc/play/index.html`

## Troubleshooting

> DOMException: Permission denied by system

In recent versions of MacOS, you may need to explicitly configure your privacy settings to allow the Chrome browser to screen record.

Check System Preferences > Security & Privacy > Privacy > Camera & Microphone. Make sure Chrome is listed and has a checkbox. If the checkbox is unchecked, check it, and follow the prompt to allow Chrome to restart. Without a restart, the change will not propagate and you will continue to see the error.

For more information, please see this [Stack Overflow post](https://stackoverflow.com/questions/59000581/google-chrome-domexception-permission-denied-by-system-for-navigator-mediadevic).
