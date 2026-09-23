import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { getPeerConnection, subscribePeerConnection } from '../diagnostics/connections';
import { logEvent } from '../diagnostics/signalLog';
import { startStatsPolling } from '../diagnostics/stats';
import { createStatsWatcher } from '../diagnostics/statsWatcher';

export const HISTORY_LENGTH = 60;

/*
 * Live connection statistics for a role ('play' | 'publish'), plus a rolling history for
 * the sparklines.
 *
 * Returns { stats, history, connectionState }. All are empty/null until a connection
 * exists, which is the normal state before the user presses Publish or Play.
 */
const fresh = (peerConnection) => ({ peerConnection, stats: null, history: [], connectionState: null });

const useConnectionStats = (role, intervalMs = 1000) => {
  const subscribe = useCallback((onChange) => subscribePeerConnection(role, onChange), [role]);
  const peerConnection = useSyncExternalStore(subscribe, () => getPeerConnection(role));

  // State is tagged with the connection it came from, so a new connection (or none) reads as
  // empty without resetting anything inside the effect.
  const [sampled, setSampled] = useState(() => fresh(null));

  useEffect(() => {
    if (!peerConnection) return undefined;
    const ofThis = (prev) => (prev.peerConnection === peerConnection ? prev : fresh(peerConnection));

    // A new connection gets a new watcher, so drift is measured from its own baseline.
    const watch = createStatsWatcher(role, logEvent);

    // connectionState is read on every sample: close() fires no connectionstatechange, so the
    // event alone would leave "connected" on screen after an abandoned attempt.
    const onSample = (sample) => {
      watch(sample);
      setSampled((prev) => {
        const current = ofThis(prev);
        const history = [...current.history, sample];
        return {
          ...current,
          stats: sample,
          connectionState: peerConnection.connectionState,
          history: history.length > HISTORY_LENGTH ? history.slice(history.length - HISTORY_LENGTH) : history,
        };
      });
    };
    const onStateChange = () =>
      setSampled((prev) => ({ ...ofThis(prev), connectionState: peerConnection.connectionState }));

    peerConnection.addEventListener('connectionstatechange', onStateChange);
    const stopSampling = startStatsPolling(peerConnection, onSample, intervalMs);

    return () => {
      stopSampling();
      peerConnection.removeEventListener('connectionstatechange', onStateChange);
    };
  }, [peerConnection, role, intervalMs]);

  if (sampled.peerConnection !== peerConnection || !peerConnection) {
    return { stats: null, history: [], connectionState: peerConnection ? peerConnection.connectionState : null };
  }
  return { stats: sampled.stats, history: sampled.history, connectionState: sampled.connectionState };
};

export default useConnectionStats;