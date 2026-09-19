/*
 * Estimating how far a second machine's clock sits from this one, NTP style.
 *
 * The latency probe stamps a frame with the publisher's clock and reads it back on the
 * player's clock. When both ends are one browser, or two browsers on one machine, those
 * clocks are the same clock and this module is not needed. When they are two machines it
 * is the only thing standing between the page and a confidently wrong latency, which is
 * the exact failure the whole feature exists to delete.
 *
 * THE WEAKEST CLAIM IN THE DESIGN, stated plainly so nobody has to go looking for it:
 *
 *   - This estimator's entire error budget is PATH ASYMMETRY. A round trip measures the
 *     sum of the two legs. Splitting that sum in half assumes the legs are equal, and
 *     nothing here can check that assumption. If the path to the Engine is 10 ms and the
 *     path back is 60 ms, the offset comes out 25 ms wrong and every quality signal in
 *     this file still reads healthy. rtt_min / 2 is the bound on that error, which is why
 *     it is reported as the uncertainty rather than as a precision.
 *   - It has NEVER been validated on an asymmetric path. Every measurement behind this
 *     design was taken with publisher and player sharing one clock, so the true offset was
 *     zero by construction and the loopback round trip was 0 to 1 ms. An estimator whose
 *     only error source is asymmetry was therefore tested where asymmetry cannot exist.
 *   - Validating it needs two machines disciplined to the same NTP source, so the true
 *     offset is known independently, one on LAN and one over VPN or a hotspot. Report the
 *     estimator's error against that truth, not its own self-reported spread.
 *
 * Until that run happens, a cross-machine figure is an estimate with a stated bound and
 * must never be shown as a bare number.
 */

/*
 * Only the most recent samples count. An offset measured a minute ago can still hold the
 * lowest round trip of the session, and it will keep winning long after an NTP slew has
 * moved the remote clock out from under it. Capping the window bounds how stale the
 * winning sample can be; at a probe cadence of a few per second this is a few seconds of
 * history.
 */
export const WINDOW_SAMPLES = 32;

/*
 * Below this many usable samples there is no window to take a minimum over: one delayed
 * reply is then the whole estimate. Eight is deliberately small enough to produce an
 * answer within the first couple of seconds of a session, and large enough that the
 * minimum is a real minimum rather than a coin toss.
 */
export const MIN_SAMPLES = 8;

/*
 * Stability is judged on the three lowest-RTT samples only. Scatter among the slow samples
 * is expected and harmless: a sample with a 400 ms round trip is allowed to be 200 ms off,
 * which is precisely why the minimum is what gets used. Scatter among the fastest samples
 * is not explainable that way and means something else moved.
 */
export const STABILITY_SAMPLES = 3;

/*
 * Date.now() is whole milliseconds and browsers coarsen timers further, so four timestamps
 * can disagree by a couple of milliseconds with no clock movement at all. Without this
 * floor a loopback path, where rtt_min is legitimately 0 or 1 ms, would declare itself
 * unstable on rounding alone.
 */
export const CLOCK_GRANULARITY_MS = 2;

/*
 * Policy, not measurement: above this the design says show "clock offset too uncertain to
 * measure" instead of a latency. It lives here so the estimator and the UI cannot drift
 * apart, but the estimator deliberately does not apply it. An estimate with a large,
 * honestly reported bound is still a measurement; what to display is the caller's call.
 * Starting value taken from the design, not from data.
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
   * Each leg is checked on its own, not only their difference. t0 and t3 are both on this
   * clock and t3 cannot precede t0; t1 and t2 are both on the far clock and a reply cannot
   * precede the request that caused it. Either one running backwards is a clock that moved
   * mid-sample, and the combined round trip hides both cases. Measured against this module
   * before the check existed: a far end whose clock stepped back 60 ms during turnaround
   * produced a plausible 80 ms round trip that won the window outright and put the offset
   * 40 ms wrong, and a sample with both legs backwards cancelled into a positive 10 ms
   * round trip carrying a 105 ms error, which then poisoned an otherwise healthy window
   * into refusing altogether.
   */
  if (localElapsed < 0 || farTurnaround < 0) return null;

  // A turnaround longer than the whole exchange is the same class of nonsense.
  const rtt = localElapsed - farTurnaround;
  if (rtt < 0) return null;

  return { rtt, offset: ((t1 - t0) + (t2 - t3)) / 2 };
};

/**
 * Estimate the far end's clock offset from a set of round-trip samples.
 *
 * The array must be in the order the samples were taken, oldest first, because only the
 * last WINDOW_SAMPLES of it are considered. Handing this a newest-first history is not
 * detectable here and would quietly pin the estimate to the oldest samples in the session.
 *
 * Returns { offsetMs, uncertaintyMs, samples }, or NULL when the offset cannot be trusted.
 * Null is a valid, expected answer and the caller must render it as "cannot measure" rather
 * than as zero: an offset of zero is what a same-machine session legitimately reports, so
 * the two must never collapse into one displayed value.
 *
 * `samples` is how many usable samples the window held, which is the evidence the refusal
 * rules were applied over. It is not how many were averaged into the answer: offsetMs comes
 * from exactly one sample, the fastest, and nothing is averaged anywhere in this module.
 */
export const estimateOffset = (samples) => {
  if (!Array.isArray(samples)) return null;

  const usable = samples
    .slice(-WINDOW_SAMPLES)
    .map(measure)
    .filter((m) => m !== null);

  if (usable.length < MIN_SAMPLES) return null;

  /*
   * The minimum-RTT sample, not the average. Standard NTP practice: queuing delay is
   * one-sided and unbounded, so averaging folds every queued reply into the answer, while
   * the fastest observed round trip is the one that spent the least time in a queue and
   * therefore carries the least asymmetry. Averaging here would make the estimate worse
   * the longer the window ran.
   */
  const byRtt = [...usable].sort((a, b) => a.rtt - b.rtt);
  const best = byRtt[0];

  /*
   * How far apart two of the fastest samples may legitimately land: each offset is wrong by
   * at most half its own round trip, so a pair can differ by at most (rtt_i + rtt_j) / 2.
   * Anything wider is not path asymmetry. It is a clock step, an NTP slew, a suspended tab,
   * or a far end that batched its replies, and none of those produce an offset worth
   * quoting.
   *
   * Judged pair by pair rather than as one spread against a single tolerance, because a
   * single tolerance has to be taken from the slowest of the three and that lets a slow
   * sample vouch for fast ones it knows nothing about. Measured against this module before
   * the change: round trips of 1, 1 and 400 ms with a 300 ms clock step between the two
   * 1 ms samples passed a spread-against-400 test and was reported as an offset accurate to
   * plus or minus 0.5 ms.
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
