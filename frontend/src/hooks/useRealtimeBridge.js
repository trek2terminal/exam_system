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
  }, 1200);
}

export function useRealtimeBridge(role) {
  const loadBootstrap = useAppStore(state => state.loadBootstrap);
  const loadDashboard = useAppStore(state => state.loadDashboard);
  const refreshTimerRef = useRef(null);
  const refreshInFlightRef = useRef(false);
  const queuedRefreshRef = useRef(false);

  useEffect(() => {
    if (!role) return undefined;

    const socket = createRealtimeSocket();
    const shouldRefreshDashboard = () => {
      const path = window.location.pathname.replace(/^\/react/, "") || "/";
      return (
        path === "/student"
        || path === "/student/exams"
        || path === "/admin"
        || path === "/teacher"
        || path === "/teacher/exams"
      );
    };

    const runShellRefresh = async () => {
      if (refreshInFlightRef.current) {
        queuedRefreshRef.current = true;
        return;
      }
      refreshInFlightRef.current = true;
      try {
        await loadBootstrap({ silent: true });
        if (shouldRefreshDashboard()) {
          await loadDashboard(role);
        }
      } finally {
        refreshInFlightRef.current = false;
        if (queuedRefreshRef.current) {
          queuedRefreshRef.current = false;
          refreshTimerRef.current = window.setTimeout(runShellRefresh, 900);
        }
      }
    };

    const refreshShell = (detail, announce = true) => {
      if (announce) announceRealtimeChange(detail);
      window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(runShellRefresh, 800);
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
