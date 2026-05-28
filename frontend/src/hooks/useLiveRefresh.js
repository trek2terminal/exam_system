import { useCallback, useEffect, useRef, useState } from "react";

export function useLiveRefresh(refreshFn, { enabled = true, intervalMs = 30000, staleAfterMs } = {}) {
  const refreshRef = useRef(refreshFn);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const pulseTimerRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [pulse, setPulse] = useState(false);
  const staleThreshold = staleAfterMs || Math.max(intervalMs * 2, 30000);

  const markUpdated = useCallback(() => {
    const syncedAt = Date.now();
    setLastUpdated(syncedAt);
    setPulse(true);
    window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulse(false), 1200);
    return syncedAt;
  }, []);

  useEffect(() => {
    refreshRef.current = refreshFn;
  }, [refreshFn]);

  const runRefresh = useCallback(async () => {
    if (!enabled || !refreshRef.current) return null;
    if (document.visibilityState === "hidden") {
      pendingRef.current = true;
      return null;
    }
    if (inFlightRef.current) {
      pendingRef.current = true;
      return null;
    }

    inFlightRef.current = true;
    setRefreshing(true);
    try {
      const result = await refreshRef.current(true);
      markUpdated();
      return result;
    } finally {
      inFlightRef.current = false;
      setRefreshing(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        window.setTimeout(runRefresh, 450);
      }
    }
  }, [enabled, markUpdated]);

  useEffect(() => {
    if (!enabled) return undefined;
    let debounceTimer;
    const scheduleRefresh = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(runRefresh, 650);
    };
    const onVisible = () => {
      if (document.visibilityState !== "hidden") scheduleRefresh();
    };
    window.addEventListener("exam:realtime-change", scheduleRefresh);
    window.addEventListener("focus", scheduleRefresh);
    document.addEventListener("visibilitychange", onVisible);
    const intervalId = intervalMs > 0 ? window.setInterval(scheduleRefresh, intervalMs) : null;
    return () => {
      window.clearTimeout(debounceTimer);
      if (intervalId) window.clearInterval(intervalId);
      window.removeEventListener("exam:realtime-change", scheduleRefresh);
      window.removeEventListener("focus", scheduleRefresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, intervalMs, runRefresh]);

  useEffect(() => () => window.clearTimeout(pulseTimerRef.current), []);

  return {
    refreshing,
    pulse,
    lastUpdated,
    isStale: Boolean(lastUpdated && Date.now() - lastUpdated > staleThreshold),
    refreshNow: runRefresh,
    markUpdated
  };
}
