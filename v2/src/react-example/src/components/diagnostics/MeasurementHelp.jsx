import React, { useCallback, useRef } from 'react';

/*
 * What the readings mean, behind a button. The text must hold on both the player page and
 * the combined page. A <dialog> gives modality, focus containment, Escape and the backdrop.
 */

const MeasurementHelp = ({ label = 'More info' }) => {
  const dialog = useRef(null);

  const open = useCallback(() => dialog.current?.showModal(), []);
  const close = useCallback(() => dialog.current?.close(), []);

  // The backdrop is part of the dialog element, so a click on it lands on the dialog itself.
  const onBackdrop = useCallback((event) => {
    if (event.target === dialog.current) dialog.current.close();
  }, []);

  return (
    <>
      <button
        type="button"
        id="measurement-help-open"
        className="wz-help__open"
        onClick={open}
      >
        {label}
      </button>

      <dialog ref={dialog} className="wz-help" id="measurement-help" onClick={onBackdrop}>
        <div className="wz-help__head">
          <h2 className="wz-help__title">How these numbers are measured</h2>
          <button
            type="button"
            className="wz-help__close"
            id="measurement-help-close"
            aria-label="Close"
            onClick={close}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>

        <div className="wz-help__body">
          <table className="wz-help__table">
            <thead>
              <tr>
                <th scope="col">Reading</th>
                <th scope="col">Source</th>
                <th scope="col">What it is</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Round trip</th>
                <td>Measured, on the active ICE candidate pair</td>
                <td>This browser to the server and back.</td>
              </tr>
              <tr>
                <th scope="row">Latency</th>
                <td>Calculated</td>
                <td>Half the round trip, plus the jitter buffer.</td>
              </tr>
              <tr>
                <th scope="row">Publisher to player</th>
                <td>Measured, from a marker inside the frame</td>
                <td>One frame, publisher&apos;s encoder to player&apos;s decoder.</td>
              </tr>
            </tbody>
          </table>

          <h3>Round trip is not latency</h3>
          <p>
            It times a small probe packet, not a frame. A 1080p frame is many packets that have
            to be paced out, carried, reassembled and held until the next frame is due.
          </p>
          <p>
            A publisher and a player each measure their own round trip, and each one is a link
            between a browser and the server. Two of them on screen are not two halves of one
            path and do not add up.
          </p>

          <h3>Latency covers the last hop only</h3>
          <p>
            It is built from RTP and RTCP counters on this player&apos;s connection, which
            describe the leg from the server. The server originates the stream the player
            receives, so those counters do not reach back to the publisher. The arithmetic also
            assumes the path is symmetric.
          </p>

          <h3>The probe covers the whole path</h3>
          <p>
            Its timestamp travels inside the frame from the publisher, so it includes the
            publisher&apos;s packetization, the server, and this player&apos;s jitter buffer. It
            is normally several times the Latency estimate. The difference is the part the
            counters cannot see.
          </p>

          <h3>Packet loss is per direction</h3>
          <p>
            A publisher reports loss on the way up, as the server reported it back. A player
            reports loss on the way down. Zero on one side next to a figure on the other says
            which leg to look at.
          </p>
          <p>
            <code>Frames missed</code> moves with it: a lost packet destroys the whole frame it
            belonged to, and one 1080p frame spans many packets.
          </p>

          <h3>Not included anywhere</h3>
          <p>
            Camera sensor and image processing, the encoder queue ahead of the marker, and the
            display itself. The display time is the browser&apos;s prediction of when the frame
            will be shown, not an observation of it. The delay you can see by waving at the
            camera is larger than any figure here.
          </p>
        </div>
      </dialog>
    </>
  );
};

export default MeasurementHelp;
