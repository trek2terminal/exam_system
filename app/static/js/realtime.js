(function () {
    if (!window.io) return;

    let socket = null;
    const joinedProctorExams = new Set();
    let refreshTimer = null;

    function ensureSocket() {
        if (socket) return socket;
        socket = window.io({ transports: ["websocket", "polling"] });
        socket.on("realtime:error", data => {
            if (data?.message) console.warn("Realtime:", data.message);
        });
        return socket;
    }

    function debounceRefresh(callbackName) {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
            if (typeof window[callbackName] === "function") {
                window[callbackName]();
            }
        }, 250);
    }

    function joinStudentSession(sessionCode, sessionToken) {
        if (!sessionCode || !sessionToken) return;
        const activeSocket = ensureSocket();
        activeSocket.emit("student:join", {
            session_code: sessionCode,
            session_token: sessionToken
        });

        activeSocket.on("exam:terminated", payload => {
            showProctorWarning?.("Exam ended", payload?.reason || "Your exam was ended by admin.");
            setTimeout(() => {
                window.location.replace(payload?.redirect || `/student/submitted/${sessionCode}`);
            }, 900);
        });
        activeSocket.on("exam:time_reduced", payload => {
            if (typeof window.syncExamStatus === "function") {
                window.syncExamStatus({ remaining_seconds: payload?.newRemainingSeconds });
            }
            showToast?.("Your remaining time has been adjusted.", "warning", 6000);
        });
        activeSocket.on("exam:paused", payload => {
            setPauseOverlay?.(true, payload?.message || "Your exam timer is paused by admin.");
        });
        activeSocket.on("exam:resumed", payload => {
            setPauseOverlay?.(false, payload?.message || "Your exam has resumed.");
            if (typeof window.syncExamStatus === "function" && typeof payload?.remainingSeconds === "number") {
                window.syncExamStatus({ remaining_seconds: payload.remainingSeconds, paused: false });
            }
        });
        activeSocket.on("exam:second_chance", payload => {
            showToast?.(payload?.message || "Second chance granted.", "success", 6000);
            sendHeartbeat?.(sessionCode, document.hasFocus());
        });
        activeSocket.on("exam:admin_message", payload => {
            const message = payload?.message || "Admin sent you a message.";
            showToast?.(message, "warning", 8000);
            showProctorWarning?.("Admin message", message);
        });
        activeSocket.on("exam:submitted", payload => {
            window.location.replace(payload?.redirect || `/student/submitted/${sessionCode}`);
        });
    }

    function joinProctorExams(examIds, refreshCallbackName) {
        const activeSocket = ensureSocket();
        (examIds || []).forEach(examId => {
            const cleanId = parseInt(examId, 10);
            if (!cleanId || joinedProctorExams.has(cleanId)) return;
            joinedProctorExams.add(cleanId);
            activeSocket.emit("proctor:join", { exam_id: cleanId });
        });

        ["proctor:violation_alert", "proctor:student_status", "proctor:exam_submitted"].forEach(eventName => {
            activeSocket.off(eventName);
            activeSocket.on(eventName, () => debounceRefresh(refreshCallbackName || "refreshProctoring"));
        });
    }

    window.ExamRealtime = {
        joinStudentSession,
        joinProctorExams
    };

    document.addEventListener("DOMContentLoaded", () => {
        const shell = document.querySelector(".exam-shell[data-session-code][data-session-token]");
        if (shell) {
            joinStudentSession(shell.dataset.sessionCode, shell.dataset.sessionToken);
        }
    });
})();
