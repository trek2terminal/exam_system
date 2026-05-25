import { useEffect, useRef } from "react";
import { createRealtimeSocket } from "../services/realtime";
import { useAppStore } from "../store/appStore";

const DATA_EVENTS = [
  "app:data_changed",
  "proctor:student_status",
  "proctor:violation_alert",
  "proctor:exam_submitted",
  "exam:terminated",
  "exam:time_reduced",
  "exam:paused",
  "exam:resumed",
  "exam:second_chance",
  "exam:admin_message",
  "exam:submitted"
];

function announceRealtimeChange(detail) {
  window.dispatchEvent(new window.CustomEvent("exam:realtime-change", { detail }));
  document.documentElement.classList.add("live-data-updated");
  window.clearTimeout(window.__examLiveUpdateTimer);
  window.__examLiveUpdateTimer = window.setTimeout(() => {
    document.documentElement.classList.remove("live-data-updated");
  }, 900);
}

export function useRealtimeBridge(role) {
  const loadBootstrap = useAppStore(state => state.loadBootstrap);
  const loadDashboard = useAppStore(state => state.loadDashboard);
  const refreshTimerRef = useRef(null);

  useEffect(() => {
    if (!role) return undefined;

    const socket = createRealtimeSocket();
    const refreshShell = (detail, announce = true) => {
      if (announce) announceRealtimeChange(detail);
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(async () => {
        await loadBootstrap({ silent: true });
        await loadDashboard(role);
      }, 450);
    };

    const handleChange = payload => refreshShell(payload || {});
    DATA_EVENTS.forEach(eventName => socket.on(eventName, handleChange));
    socket.connect();

    const focusRefresh = () => {
      if (document.visibilityState !== "hidden") refreshShell({ source: "focus" }, false);
    };
    window.addEventListener("focus", focusRefresh);
    document.addEventListener("visibilitychange", focusRefresh);

    return () => {
      window.clearTimeout(refreshTimerRef.current);
      DATA_EVENTS.forEach(eventName => socket.off(eventName, handleChange));
      socket.disconnect();
      window.removeEventListener("focus", focusRefresh);
      document.removeEventListener("visibilitychange", focusRefresh);
    };
  }, [loadBootstrap, loadDashboard, role]);
}
