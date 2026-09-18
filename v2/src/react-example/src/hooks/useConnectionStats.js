import { useEffect, useRef, useState } from 'react';

import { subscribePeerConnection } from '../diagnostics/connections';
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
const useConnectionStats = (role, intervalMs = 1000) => {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [connectionState, setConnectionState] = useState(null);
  const historyRef = useRef([]);

  useEffect(() => {
    let stopPolling = null;
    // Turns the sample stream into log entries about what changed, so the panel has
    // something to say once the session is up and not only while it is being set up.
    const watch = createStatsWatcher(role, logEvent);

    /*
     * Set on every sample, not only when the browser says it changed.
     *
     * connectionstatechange is not dispatched for close(), and an attempt abandoned by the
     * error path closes the connection without ever transitioning through a state the
     * browser reports. The panel was left showing the last state it had been told about,
     * which is how "connected" survived a session that had been shut, beside media tiles
     * that had gone blank. Reading the property costs nothing and cannot go stale.
     */
    const onSample = (sample, peerConnection) => {
      setConnectionState(peerConnection.connectionState);
      watch(sample);
      setStats(sample);
      // Keep the last HISTORY_LENGTH samples: one minute at the default interval.
      const next = [...historyRef.current, sample];
      historyRef.current = next.length > HISTORY_LENGTH
        ? next.slice(next.length - HISTORY_LENGTH)
        : next;
      setHistory(historyRef.current);
    };

    const unsubscribe = subscribePeerConnection(role, (peerConnection) => {
      if (stopPolling) {
        stopPolling();
        stopPolling = null;
      }

      if (!peerConnection) {
        watch(null);
        setStats(null);
        setConnectionState(null);
        historyRef.current = [];
        setHistory([]);
        return;
      }

      // A new connection starts a new graph, and a new baseline for the watcher, rather
      // than continuing the previous one.
      watch(null);
      historyRef.current = [];
      setHistory([]);

      setConnectionState(peerConnection.connectionState);
      const onStateChange = () => setConnectionState(peerConnection.connectionState);
      peerConnection.addEventListener('connectionstatechange', onStateChange);

      const stopSampling = startStatsPolling(
        peerConnection, (sample) => onSample(sample, peerConnection), intervalMs);
      stopPolling = () => {
        stopSampling();
        peerConnection.removeEventListener('connectionstatechange', onStateChange);
      };
    });

    return () => {
      if (stopPolling) stopPolling();
      unsubscribe();
    };
  }, [role, intervalMs]);

  return { stats, history, connectionState };
};

export default useConnectionStats;