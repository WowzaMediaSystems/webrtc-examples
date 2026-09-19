/*
 * Where a player's latency goes, decomposed.
 *
 * This used to try to describe the whole path from camera to screen by taking a measured
 * total and subtracting each end's network leg. That only worked on the combined page,
 * where both ends happen to be in one browser, and even there the total it needed was never
 * measured - so it showed two network legs, a dash, and nothing anyone could act on.
 *
 * A player on its own can measure its own half of the path exactly, and that half is the
 * one a viewer actually experiences:
 *
 *   network      half the round trip to the Engine, from the ICE candidate pair
 *   jitter buf   how long a frame waits before it is played, from the receiver's own stats
 *   ---------------------------------------------------------------------------------
 *   receiver     the two added together
 *
 * What it deliberately does not claim to include: capture, encode, anything the Engine adds,
 * decode, and display. Those are real and they are not in here, so the figure is named for
 * what it is and the caveat travels with it rather than sitting in a doc nobody reads.
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
