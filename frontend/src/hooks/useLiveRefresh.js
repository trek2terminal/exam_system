import { useCallback, useEffect, useRef, useState } from "react";

export function useLiveRefresh(refreshFn, { enabled = true, intervalMs = 30000 } = {}) {
  const refreshRef = useRef(refreshFn);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    refreshRef.current = refreshFn;
  }, [refreshFn]);

  const runRefresh = useCallback(async () => {
    if (!enabled || !refreshRef.current) return;
    if (document.visibilityState === "hidden") {
      pendingRef.current = true;
      return;
    }
    if (inFlightRef.current) {
      pendingRef.current = true;
      return;
    }

    inFlightRef.current = true;
    setRefreshing(true);
    try {
      await refreshRef.current(true);
      setPulse(true);
      window.setTimeout(() => setPulse(false), 420);
    } finally {
      inFlightRef.current = false;
      setRefreshing(false);
      if (pendingRef.current) {
        pendingRef.current = false;
        window.setTimeout(runRefresh, 250);
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return undefined;
    let debounceTimer;
    const scheduleRefresh = () => {
      window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(runRefresh, 350);
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

  return { refreshing, pulse };
}
