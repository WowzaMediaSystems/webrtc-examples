/*
 * Estimates how far a second machine's clock sits from this one, NTP style. Only needed when
 * publisher and player are on different machines.
 *
 * The whole error budget is path asymmetry: halving a round trip assumes equal legs, and
 * nothing here can check that. rtt_min / 2 bounds the error, so it is reported as the
 * uncertainty. Not yet validated on an asymmetric path, so a cross-machine figure must never
 * be shown as a bare number.
 */

/*
 * Only recent samples count, so an old low-RTT sample cannot keep winning after an NTP slew
 * has moved the remote clock.
 */
export const WINDOW_SAMPLES = 32;

/* Fewer usable samples than this and one delayed reply would be the whole estimate. */
export const MIN_SAMPLES = 8;

/*
 * Stability is judged on the three lowest-RTT samples only. Scatter among slow samples is
 * expected; scatter among the fastest means something else moved.
 */
export const STABILITY_SAMPLES = 3;

/*
 * Date.now() is whole milliseconds and browsers coarsen timers further. Without this floor a
 * loopback path (rtt_min 0 or 1 ms) would declare itself unstable on rounding alone.
 */
export const CLOCK_GRANULARITY_MS = 2;

/*
 * Policy from the design, not from data: above this the UI shows "too uncertain to measure".
 * The estimator does not apply it; what to display is the caller's call.
 */
export const MAX_TRUSTED_UNCERTAINTY_MS = 30;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/*
 * t0 sent, t1 received by the far end, t2 replied by the far end, t3 reply received.
 * offset is the far clock minus this clock: farNow = localNow + offsetMs.
 * rtt subtracts the far end's own turnaround, so a slow responder is not read as a slow
 * path.
 */
const measure = (sample) => {
  if (!sample) return null;
  const { t0, t1, t2, t3 } = sample;
  if (![t0, t1, t2, t3].every(isFiniteNumber)) return null;

  const localElapsed = t3 - t0;
  const farTurnaround = t2 - t1;

  /*
   * Each leg is checked on its own: either one running backwards is a clock that moved
   * mid-sample, and the combined round trip can hide it as a plausible positive value.
   */
  if (localElapsed < 0 || farTurnaround < 0) return null;

  // A turnaround longer than the whole exchange is the same class of nonsense.
  const rtt = localElapsed - farTurnaround;
  if (rtt < 0) return null;

  return { rtt, offset: ((t1 - t0) + (t2 - t3)) / 2 };
};

/**
 * Estimate the far end's clock offset from round-trip samples, oldest first (only the last
 * WINDOW_SAMPLES are considered).
 *
 * Returns { offsetMs, uncertaintyMs, samples }, or null when the offset cannot be trusted.
 * Render null as "cannot measure", never as zero: zero is a legitimate same-machine offset.
 * `samples` is how many usable samples the window held; offsetMs comes from the single
 * fastest one.
 */
export const estimateOffset = (samples) => {
  if (!Array.isArray(samples)) return null;

  const usable = samples
    .slice(-WINDOW_SAMPLES)
    .map(measure)
    .filter((m) => m !== null);

  if (usable.length < MIN_SAMPLES) return null;

  /*
   * The minimum-RTT sample, not the average (standard NTP practice): queuing delay is
   * one-sided, so the fastest round trip carries the least asymmetry.
   */
  const byRtt = [...usable].sort((a, b) => a.rtt - b.rtt);
  const best = byRtt[0];

  /*
   * Each offset is wrong by at most half its round trip, so two of the fastest samples may
   * differ by at most (rtt_i + rtt_j) / 2; wider is a clock step, slew or suspended tab.
   * Checked pair by pair so a slow sample cannot vouch for fast ones.
   */
  const fastest = byRtt.slice(0, STABILITY_SAMPLES);
  const agree = fastest.every((a, i) => fastest.slice(i + 1).every(
    (b) => Math.abs(a.offset - b.offset) <= Math.max((a.rtt + b.rtt) / 2, CLOCK_GRANULARITY_MS),
  ));
  if (!agree) return null;

  return {
    offsetMs: best.offset,
    // The bound on the asymmetry error, which is the only error this estimator has.
    uncertaintyMs: best.rtt / 2,
    samples: usable.length,
  };
};
