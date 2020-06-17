/*
 * This code and all components (c) Copyright 2019-2020, Wowza Media Systems, LLC. All rights reserved.
 * This code is licensed pursuant to the BSD 3-Clause License.
 */


const browserDetails = window.adapter.browserDetails;

let SDPOutput;
let videoChoice;
let audioChoice;
let videoIndex;
let audioIndex;

function addAudio(sdpStr, audioLine) {
  let sdpLines = sdpStr.split(/\r\n/);
  let sdpSection = 'header';
  let hitMID = false;
  let sdpStrRet = '';
  let done = false;

  for (let sdpIndex in sdpLines) {
    let sdpLine = sdpLines[sdpIndex];

    if (sdpLine.length <= 0)
      continue;

    sdpStrRet += sdpLine;
    sdpStrRet += '\r\n';

    if ('a=rtcp-mux'.localeCompare(sdpLine) == 0 && done == false) {
      sdpStrRet += audioLine;
      done = true;
    }
  }
  return sdpStrRet;
}

function addVideo(sdpStr, videoLine) {
  let sdpLines = sdpStr.split(/\r\n/);
  let sdpSection = 'header';
  let hitMID = false;
  let sdpStrRet = '';
  let done = false;

  let rtcpSize = false;
  let rtcpMux = false;

  for (let sdpIndex in sdpLines) {
    let sdpLine = sdpLines[sdpIndex];

    if (sdpLine.length <= 0)
      continue;

    if (sdpLine.includes("a=rtcp-rsize")) {
      rtcpSize = true;
    }

    if (sdpLine.includes("a=rtcp-mux")) {
      rtcpMux = true;
    }

  }

  for (let sdpIndex in sdpLines) {
    let sdpLine = sdpLines[sdpIndex];

    sdpStrRet += sdpLine;
    sdpStrRet += '\r\n';

    if (('a=rtcp-rsize'.localeCompare(sdpLine) == 0) && done == false && rtcpSize == true) {
      sdpStrRet += videoLine;
      done = true;
    }

    if ('a=rtcp-mux'.localeCompare(sdpLine) == 0 && done == true && rtcpSize == false) {
      sdpStrRet += videoLine;
      done = true;
    }

    if ('a=rtcp-mux'.localeCompare(sdpLine) == 0 && done == false && rtcpSize == false) {
      done = true;
    }

  }
  return sdpStrRet;
}

// Filter codec offerings
function deliverCheckLine(profile, type) {
  let outputString = "";
  for (let line in SDPOutput) {
    let lineInUse = SDPOutput[line];
    outputString += line;
    if (lineInUse.includes(profile)) {
      if (profile.includes("VP9") || profile.includes("VP8")) {
        let output = "";
        let outputs = lineInUse.split(/\r\n/);
        for (let position in outputs) {
          let transport = outputs[position];
          // NOTE: This block of code is needed for WSE versions older than 4.8.5
          // if (transport.indexOf("a=extmap") !== -1 ||
          //   transport.indexOf("transport-cc") !== -1 ||
          //   transport.indexOf("goog-remb") !== -1 ||
          //   transport.indexOf("nack") !== -1) {
          //   continue;
          // }
          output += transport;
          output += "\r\n";
        }

        if (type.includes("audio")) {
          audioIndex = line;
        }

        if (type.includes("video")) {
          videoIndex = line;
        }

        return output;
      }
      if (type.includes("audio")) {
        audioIndex = line;
      }

      if (type.includes("video")) {
        videoIndex = line;
      }
      return lineInUse;
    }
  }
  return outputString;
}

function checkLine(line) {
  if (line.startsWith("a=rtpmap") || line.startsWith("a=rtcp-fb") || line.startsWith("a=fmtp")) {
    let res = line.split(":");

    if (res.length > 1) {
      let number = res[1].split(" ");
      if (!isNaN(number[0])) {
        if (!number[1].startsWith("http") && !number[1].startsWith("ur")) {
          let currentString = SDPOutput[number[0]];
          if (!currentString) {
            currentString = "";
          }
          currentString += line + "\r\n";
          SDPOutput[number[0]] = currentString;
          return false;
        }
      }
    }
  }

  return true;
}

function getrtpMapID(line) {
  let findid = new RegExp('a=rtpmap:(\\d+) (\\w+)/(\\d+)');
  let found = line.match(findid);
  return (found && found.length >= 3) ? found : null;
}

export function mungeSDPPublish(sdpStr, mungeData) {

  SDPOutput = new Object();
  videoChoice = "42e01f";
  audioChoice = "opus";
  videoIndex = -1;
  audioIndex = -1;

  let sdpLines = sdpStr.split(/\r\n/);

  let sdpSection = 'header';
  let hitMID = false;
  let sdpStrRet = '';

  if (mungeData.videoCodec != null && mungeData.videoCodec !== '')
    videoChoice = mungeData.videoCodec;
  if (mungeData.audioCodec != null && mungeData.audioCodec !== '')
    audioChoice = mungeData.audioCodec;

  // Deliver the requested codecs
  for (let sdpIndex in sdpLines) {
    let sdpLine = sdpLines[sdpIndex];

    if (sdpLine.length <= 0)
      continue;

    let doneCheck = checkLine(sdpLine);
    if (!doneCheck)
      continue;

    sdpStrRet += sdpLine;
    sdpStrRet += '\r\n';

  }
  sdpStrRet = addAudio(sdpStrRet, deliverCheckLine(audioChoice, "audio"));
  sdpStrRet = addVideo(sdpStrRet, deliverCheckLine(videoChoice, "video"));
  sdpStr = sdpStrRet;
  sdpLines = sdpStr.split(/\r\n/);
  sdpStrRet = '';

  for (let sdpIndex in sdpLines) {
    let sdpLine = sdpLines[sdpIndex];

    if (sdpLine.length <= 0)
      continue;

    if (browserDetails.browser === 'chrome') {
      let audioMLines;
      if (sdpLine.indexOf("m=audio") == 0 && audioIndex != -1) {
        audioMLines = sdpLine.split(" ");
        sdpStrRet += audioMLines[0] + " " + audioMLines[1] + " " + audioMLines[2] + " " + audioIndex + "\r\n";
        continue;
      }

      if (sdpLine.indexOf("m=video") == 0 && videoIndex != -1) {
        audioMLines = sdpLine.split(" ");
        sdpStrRet += audioMLines[0] + " " + audioMLines[1] + " " + audioMLines[2] + " " + videoIndex + "\r\n";
        continue;
      }
    }

    sdpStrRet += sdpLine;

    if (sdpLine.indexOf("m=audio") === 0) {
      sdpSection = 'audio';
      hitMID = false;
    }
    else if (sdpLine.indexOf("m=video") === 0) {
      sdpSection = 'video';
      hitMID = false;
    }
    else if (sdpLine.indexOf("a=rtpmap") == 0) {
      sdpSection = 'bandwidth';
      hitMID = false;
    }

    if (browserDetails.browser === 'chrome') {
      if (sdpLine.indexOf("a=mid:") === 0 || sdpLine.indexOf("a=rtpmap") == 0) {
        if (!hitMID) {
          if ('audio'.localeCompare(sdpSection) == 0) {
            if (mungeData.audioBitrate !== undefined) {
              sdpStrRet += '\r\nb=CT:' + (mungeData.audioBitrate);
              sdpStrRet += '\r\nb=AS:' + (mungeData.audioBitrate);
            }
            hitMID = true;
          }
          else if ('video'.localeCompare(sdpSection) == 0) {
            if (mungeData.videoBitrate !== undefined) {
              sdpStrRet += '\r\nb=CT:' + (mungeData.videoBitrate);
              sdpStrRet += '\r\nb=AS:' + (mungeData.videoBitrate);
              if (mungeData.videoFrameRate !== undefined) {
                sdpStrRet += '\r\na=framerate:' + mungeData.videoFrameRate;
              }
            }
            hitMID = true;
          }
          else if ('bandwidth'.localeCompare(sdpSection) == 0) {
            let rtpmapID;
            rtpmapID = getrtpMapID(sdpLine);
            if (rtpmapID !== null) {
              let match = rtpmapID[2].toLowerCase();
              if (('vp9'.localeCompare(match) == 0) || ('vp8'.localeCompare(match) == 0) || ('h264'.localeCompare(match) == 0) ||
                ('red'.localeCompare(match) == 0) || ('ulpfec'.localeCompare(match) == 0) || ('rtx'.localeCompare(match) == 0)) {
                if (mungeData.videoBitrate !== undefined) {
                  sdpStrRet += '\r\na=fmtp:' + rtpmapID[1] + ' x-google-min-bitrate=' + (mungeData.videoBitrate) + ';x-google-max-bitrate=' + (mungeData.videoBitrate);
                }
              }

              if (('opus'.localeCompare(match) == 0) || ('isac'.localeCompare(match) == 0) || ('g722'.localeCompare(match) == 0) || ('pcmu'.localeCompare(match) == 0) ||
                ('pcma'.localeCompare(match) == 0) || ('cn'.localeCompare(match) == 0)) {
                if (mungeData.audioBitrate !== undefined) {
                  sdpStrRet += '\r\na=fmtp:' + rtpmapID[1] + ' x-google-min-bitrate=' + (mungeData.audioBitrate) + ';x-google-max-bitrate=' + (mungeData.audioBitrate);
                }
              }
            }
          }
        }
      }
    }

    if (browserDetails.browser === 'firefox' || browserDetails.browser === 'safari') {
      if ( sdpLine.indexOf("c=IN") ==0 )
      {
        if ('audio'.localeCompare(sdpSection) == 0)
        {
          if (mungeData.audioBitrate !== '') {
            sdpStrRet += "\r\nb=TIAS:"+(Number(mungeData.audioBitrate)*1000)+"\r\n";
            sdpStrRet += "b=AS:"+(Number(mungeData.audioBitrate)*1000)+"\r\n";
            sdpStrRet += "b=CT:"+(Number(mungeData.audioBitrate)*1000)+"\r\n";
          }
          continue;
        }
        if ('video'.localeCompare(sdpSection) == 0)
        {
          if (mungeData.videoBitrate !== '') {
            sdpStrRet += "\r\nb=TIAS:"+(Number(mungeData.videoBitrate)*1000)+"\r\n";
            sdpStrRet += "b=AS:"+(Number(mungeData.videoBitrate)*1000)+"\r\n";
            sdpStrRet += "b=CT:"+(Number(mungeData.videoBitrate)*1000)+"\r\n";
          }
          continue;
        }
      }
    }

    sdpStrRet += '\r\n';
  }
  return sdpStrRet;
}

export function mungeSDPPlay(sdpStr) {

  // For greatest playback compatibility, 
  // force H.264 playback to baseline (42e01f).

  let sdpLines = sdpStr.split(/\r\n/);
  let sdpStrRet = '';

  for (var sdpIndex in sdpLines) {
    var sdpLine = sdpLines[sdpIndex];

    if (sdpLine.length == 0)
      continue;

    if (sdpLine.includes("profile-level-id")) {
      // The profile-level-id string has three parts: XXYYZZ, where
      //   XX: 42 baseline, 4D main, 64 high
      //   YY: constraint
      //   ZZ: level ID
      // Look for codecs higher than baseline and force downward.
      let profileLevelId = sdpLine.substr(sdpLine.indexOf("profile-level-id")+17,6);
      let profile = Number('0x'+profileLevelId.substr(0,2));
      let constraint = Number('0x'+profileLevelId.substr(2,2));
      let level = Number('0x'+profileLevelId.substr(4,2));
      if (profile > 0x42)
      {
        profile = 0x42;
        constraint = 0xE0;
        level = 0x1F;
      }
      let newProfileLevelId = ("00" + profile.toString(16)).slice(-2).toLowerCase() +
        ("00" + constraint.toString(16)).slice(-2).toLowerCase() +
        ("00" + level.toString(16)).slice(-2).toLowerCase();

      sdpLine = sdpLine.replace(profileLevelId,newProfileLevelId);
    }

    sdpStrRet += sdpLine;
    sdpStrRet += '\r\n';
  }

  return sdpStrRet;  
}

export default mungeSDPPublish;