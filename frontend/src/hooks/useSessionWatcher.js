import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../services/api";
import { useAppStore } from "../store/appStore";

function notifyExamSessionEnding() {
  try {
    const match = window.location.pathname.match(/\/(?:react\/)?exam\/([^/?#]+)/);
    if (!match?.[1]) return;
    window.dispatchEvent(new window.CustomEvent("exam-platform:session-ended", {
      detail: { sessionCode: match[1] }
    }));
  } catch {
    // local snapshot is best-effort only
  }
}

export function useSessionWatcher(role) {
  const navigate = useNavigate();
  const clearSession = useAppStore(state => state.clearSession);
  const [endedSession, setEndedSession] = useState(null);

  useEffect(() => {
    if (!role || endedSession) return undefined;

    let cancelled = false;
    const intervalMs = role === "admin" ? 15000 : 30000;

    async function checkSession() {
      try {
        const { data } = await api.get("/auth/session-status");
        if (cancelled || data?.valid !== false) return;

        const reason = data.reason || "signed_out_elsewhere";
        const endedRole = role;
        notifyExamSessionEnding();
        clearSession();
        setEndedSession({ role: endedRole, reason });
      } catch (error) {
        const reason = error.response?.data?.reason;
        if (cancelled || reason !== "signed_out_elsewhere") return;

        const endedRole = role;
        notifyExamSessionEnding();
        clearSession();
        setEndedSession({ role: endedRole, reason });
      }
    }

    const intervalId = window.setInterval(checkSession, intervalMs);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [clearSession, endedSession, role]);

  const goToLogin = useCallback(() => {
    const target = endedSession?.role === "admin" ? "/admin/login" : "/login";
    setEndedSession(null);
    navigate(target, { replace: true });
  }, [endedSession?.role, navigate]);

  return { endedSession, goToLogin };
}
