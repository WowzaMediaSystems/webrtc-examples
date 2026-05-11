import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import * as compositeSettingsActions from '../../actions/compositeSettingsActions';

/*
 * layouts:
 * 0 -> video 1 full
 * 1 -> video 2 full
 * 2 -> video 1 full, video 2 pip top-right
 * 3 -> video 2 full, video 1 pip top-right
 * 4 -> video 1 full, video 2 pip top-left
 * 5 -> video 1 full, video 2 pip bottom-left
 * 6 -> video 1 full, video 2 pip bottom-right
 * 7 -> side-by-side
 */


const pipScale = (1/4);
const padding = (1/16);

const fillSize = (srcSize, dstSize, scale = 1) => {

  let heightRatio = dstSize.height / srcSize.height;
  let widthRatio = dstSize.width / srcSize.width;
  let fillRatio = Math.max(heightRatio,widthRatio);
  return {
    width: srcSize.width * fillRatio * scale,
    height: srcSize.height * fillRatio * scale
  }
}

const fitSize = (srcSize, dstSize, scale = 1) => {

  let heightRatio = dstSize.height / srcSize.height;
  let widthRatio = dstSize.width / srcSize.width;
  let fillRatio = Math.min(heightRatio,widthRatio);
  return {
    width: srcSize.width * fillRatio * scale,
    height: srcSize.height * fillRatio * scale
  }
}

const pipOffset = (layout, canvasSize, pipSize,padding) => {
  
  let paddingVert = canvasSize.height * padding;
  let paddingHorz = canvasSize.width * padding;

  // PIP Top-Right
  if (layout === 2 || layout === 3) {
    return {
      top: paddingVert,
      left: canvasSize.width - pipSize.width - paddingHorz
    }
  }
  // PIP Top-Left
  if (layout === 4) {
    return {
      top: paddingVert,
      left: paddingHorz
    }
  }
  // PIP Bottom-Left
  if (layout === 5) {
    return {
      top: canvasSize.height - pipSize.height - paddingVert,
      left: paddingHorz
    }
  }
  // PIP Bottom-Right
  if (layout === 6) {
    return {
      top: canvasSize.height - pipSize.height - paddingVert,
      left: canvasSize.width - pipSize.width - paddingHorz
    }
  }

  return { top:0, left:0 };
}

// Grab frames from video1 and video2, composite on the canvas
const renderFrame = (video1, video2, canvas, layout, video1ScaleMode) => {

  let context = canvas.getContext('2d');

  // set canvas size to 720p
  canvas.width = 1280;
  canvas.height = 720;

  context.fillStyle = "gray";
  context.fillRect(0, 0, canvas.width, canvas.height);

  let video1Full = layout === 0 || layout === 2 || layout === 4 || layout === 5 || layout === 6;
  let video1Pip = layout === 3;
  let video2Full = layout === 1 || layout === 3;
  let video2Pip = layout === 2 || layout === 4 || layout === 5 || layout === 6;

  let canvasSize = { width: canvas.width, height: canvas.height };
  let video1Size = { width: video1.videoWidth, height: video1.videoHeight };
  let video2Size = { width: video2.videoWidth, height: video2.videoHeight };

  // render video1 to fill canvas
  if (video1Full && video1.readyState === video1.HAVE_ENOUGH_DATA) {
    let renderSize = (video1ScaleMode === 'fill') ? fillSize(video1Size, canvasSize, 1) : fitSize(video1Size, canvasSize, 1);
    let xOffset = (canvasSize.width - renderSize.width) / 2;
    let yOffset = (canvasSize.height - renderSize.height) / 2;
    context.drawImage(video1, xOffset, yOffset, renderSize.width, renderSize.height);
  }

  // render video2 to fill canvas
  if (video2Full && video2.readyState === video2.HAVE_ENOUGH_DATA) {
    let renderSize = fillSize(video2Size, canvasSize, 1);
    let xOffset = (canvasSize.width - renderSize.width) / 2;
    let yOffset = (canvasSize.height - renderSize.height) / 2;
    context.drawImage(video2, xOffset, yOffset, renderSize.width, renderSize.height);
  }

  // render video1 as pip
  if (video1Pip && video1.readyState === video1.HAVE_ENOUGH_DATA) {
    let renderSize = fitSize(video1Size, canvasSize, pipScale);
    let offset = pipOffset(layout,canvasSize,renderSize,padding);
    context.drawImage(video1, offset.left, offset.top, renderSize.width , renderSize.height );
  }

  // render video2 as pip
  if (video2Pip && video2.readyState === video2.HAVE_ENOUGH_DATA) {
    let renderSize = fitSize(video2Size, canvasSize, pipScale);
    let offset = pipOffset(layout,canvasSize,renderSize,padding);
    context.drawImage(video2, offset.left, offset.top, renderSize.width , renderSize.height );
  }

  // 2-up
  if (layout === 7) {
    if (video1.readyState === video1.HAVE_ENOUGH_DATA) {
      let renderSize = fitSize(video1Size, canvasSize, 0.5);
      let xOffset = (canvasSize.width/2 - renderSize.width) / 2;
      let yOffset = canvasSize.height / 2 - renderSize.height / 2;
      context.drawImage(video1, xOffset, yOffset, renderSize.width, renderSize.height);
    }
    if (video2.readyState === video2.HAVE_ENOUGH_DATA) {
      let renderSize = fitSize(video2Size, canvasSize, 0.5);
      let xOffset = (canvasSize.width - renderSize.width) + ((canvasSize.width/2 - renderSize.width) / 2);
      let yOffset = canvasSize.height / 2 - renderSize.height / 2;
      context.drawImage(video2, xOffset, yOffset, renderSize.width, renderSize.height);
    }
  }

}

const Compositor = () => {

  // Using a local 'running' state allows a user gesture to start the rendering.
  const [running, setRunning] = useState(false);

  // Using useRef() lets us use local state without triggering React renders.
  const video1Element = useRef(null);
  const video1ScaleMode = useRef('fill');
  const video2Element = useRef(null);
  const canvasElement = useRef(null);
  const layoutRef = useRef(null);

  const dispatch = useDispatch();
  const { videoTracksMap, displayScreenTrack, audioTracksMap } = useSelector ((state) => state.media);
  const { videoTrack1DeviceId, videoTrack2DeviceId, audioTrackDeviceId, layout } = useSelector ((state) => state.compositeSettings);

  layoutRef.current = layout;

  // Handle videoTrack1 changes
  useEffect(() => {
    let video1Stream = undefined;
    if (videoTrack1DeviceId === 'screen' && displayScreenTrack != null)
    {
      video1Stream = new MediaStream();
      video1Stream.addTrack(displayScreenTrack);
      video1ScaleMode.current = 'fit';
    }
    else if (videoTrack1DeviceId !== '' && videoTrack1DeviceId !== 'screen' && videoTracksMap[videoTrack1DeviceId] != null) 
    {
      video1Stream = new MediaStream();
      video1Stream.addTrack(videoTracksMap[videoTrack1DeviceId]);
      video1ScaleMode.current = 'fill';
    }
    if (video1Element != null && video1Element.current != null)
      video1Element.current.srcObject = video1Stream;

  }, [videoTracksMap, videoTrack1DeviceId, video1Element, displayScreenTrack])

  // Handle videoTrack2 changes
  useEffect(() => {
    let video2Stream = undefined;
    if (videoTrack2DeviceId !== '' && videoTracksMap[videoTrack2DeviceId] != null)
    {
      video2Stream = new MediaStream();
      video2Stream.addTrack(videoTracksMap[videoTrack2DeviceId]);
    }
    if (video2Element != null && video2Element.current != null)
      video2Element.current.srcObject = video2Stream;

  }, [videoTracksMap, videoTrack2DeviceId, video2Element]);

  // Handle microphone changes
  useEffect(() => {

    let audioTrack = undefined;
    if (audioTrackDeviceId !== '' && audioTracksMap[audioTrackDeviceId] != null)
    {
      audioTrack = audioTracksMap[audioTrackDeviceId];
    }
    if (audioTrack != null)
    {
      dispatch({type:compositeSettingsActions.SET_COMPOSITE_AUDIO_TRACK,audioTrack:audioTrack});
    }
  }, [dispatch, audioTracksMap, audioTrackDeviceId]);

  // Handle layout changes
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  // Set up canvas rendering loop.
  // Using an audio oscillator instead of requestAnimationFrame allows us to keep streaming when backgrounded.
  // Using useRef() lets us touch stateful objects without triggering React renders.

  const audioContextRef = useRef(new (window.AudioContext || window.webkitAudioContext)());
  const oscillatorRef = useRef();

  const renderLoop = useCallback(() => {
    if (video1Element.current != null && video2Element.current != null && canvasElement.current != null)
    {
      oscillatorRef.current = audioContextRef.current.createOscillator();
      oscillatorRef.current.onended = () => { renderLoop(); };
      oscillatorRef.current.start();
      oscillatorRef.current.stop(1/30);
      renderFrame(video1Element.current,video2Element.current,canvasElement.current,layoutRef.current,video1ScaleMode.current);
    }
  },[]);

  // The audioContext will be suspended until a user gesture.
  // In our case, start it when a video or audio track is selected.
  // This also re-starts rendering when the component re-mounts from a react-router navigation.

  useEffect(() => {
    audioContextRef.current.resume().then(() => {
      if (!running) {
        setRunning(true);
        renderLoop();
      }
    });
  },[running,renderLoop,videoTrack1DeviceId,videoTrack2DeviceId,audioTrackDeviceId]);

  // Set up canvas captureStream when component mounts.
  useEffect(() => {
    let ctx = canvasElement.current.getContext('2d');
    let canvasStream = canvasElement.current.captureStream(30);
    dispatch({type:compositeSettingsActions.SET_COMPOSITE_VIDEO_TRACK,videoTrack:canvasStream.getTracks()[0]});
  },[dispatch]);


  return (
    <>
      <canvas ref={canvasElement} id="publisher-canvas"></canvas>
      <video ref={video1Element} id="publisher-video1" autoPlay style={{display:'none'}}></video>
      <video ref={video2Element} id="publisher-video2" autoPlay style={{display:'none'}}></video>
    </>
  );
}

export default Compositor;