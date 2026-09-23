/*
 * Where a player's latency goes, from the half of the path a player can measure on its own:
 *
 *   network      half the round trip to the Engine, from the ICE candidate pair
 *   jitter buf   how long a frame waits before it is played, from the receiver's own stats
 *   ---------------------------------------------------------------------------------
 *   receiver     the two added together
 *
 * Not included: capture, encode, anything the Engine adds, decode, and display. The figure is
 * named for what it is, and the caveat travels with it.
 */

/** A row list for the panel, or null when there is nothing measured yet. */
export const decomposeReceiverLatency = (stats) => {
  if (!stats || stats.isReceiving !== true) return null;

  const networkMs = typeof stats.rttMs === 'number' ? stats.rttMs / 2 : null;
  const jitterBufferMs = typeof stats.jitterBufferMs === 'number' ? stats.jitterBufferMs : null;
  if (networkMs === null && jitterBufferMs === null) return null;

  const totalMs = (networkMs ?? 0) + (jitterBufferMs ?? 0);

  return {
    totalMs,
    // True when one half is missing, so the total is a floor rather than a sum.
    partial: networkMs === null || jitterBufferMs === null,
    rows: [
      {
        key: 'network',
        label: 'Engine to player',
        note: 'half the measured round trip',
        valueMs: networkMs,
      },
      {
        key: 'jitter',
        label: 'Jitter buffer',
        note: 'how long a frame waits before it plays',
        valueMs: jitterBufferMs,
      },
    ],
  };
};
