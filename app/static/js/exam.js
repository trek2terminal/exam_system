let examTimerInterval = null;
let heartbeatInterval = null;
let debounceTimers = {};
let currentSessionCode = null;
let examSubmitted = false;
let violationCount = 0;
let fullscreenWarned = false;
let fullscreenReady = false;
const MAX_VIOLATIONS = 3;

async function enterFullscreen() {
    const element = document.documentElement;
    try {
        if (element.requestFullscreen) {
            await element.requestFullscreen();
        } else if (element.webkitRequestFullscreen) {
            element.webkitRequestFullscreen();
        } else if (element.msRequestFullscreen) {
            element.msRequestFullscreen();
        }
        fullscreenReady = true;
        document.body.classList.add("exam-locked");
        document.getElementById("fullscreenGate")?.classList.remove("active");
    } catch (e) {
        document.getElementById("fullscreenGate")?.classList.add("active");
    }
}

function formatTime(seconds) {
    seconds = Math.max(0, parseInt(seconds || "0", 10));
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;

    if (h > 0) {
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function saveAnswer(sessionCode, questionId, answerText) {
    try {
        await fetch(`/api/student/session/${sessionCode}/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                question_id: questionId,
                answer_text: answerText
            })
        });
    } catch (e) {
        console.error("Autosave failed:", e);
    }
}

function snapshotAnswers() {
    const saves = [];
    document.querySelectorAll(".answer-field").forEach(field => {
        saves.push(saveAnswer(currentSessionCode, field.dataset.questionId, field.value));
    });
    document.querySelectorAll(".answer-radio:checked").forEach(radio => {
        saves.push(saveAnswer(currentSessionCode, radio.dataset.questionId, radio.value));
    });
    return saves;
}

function queueTextSave(sessionCode, questionId, answerText) {
    const key = `${sessionCode}_${questionId}`;
    if (debounceTimers[key]) clearTimeout(debounceTimers[key]);

    debounceTimers[key] = setTimeout(() => {
        saveAnswer(sessionCode, questionId, answerText);
    }, 800);
}

async function sendHeartbeat(sessionCode, focused = true) {
    try {
        const response = await fetch(`/api/student/session/${sessionCode}/heartbeat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                focused: focused,
                violation_count: violationCount
            })
        });

        const data = await response.json();
        if (data.submitted && !examSubmitted) {
            forceSubmit(sessionCode);
        }
    } catch (e) {
        console.error("Heartbeat failed:", e);
    }
}

function forceSubmit(sessionCode) {
    if (examSubmitted) return;
    examSubmitted = true;
    window.location.href = `/student/submitted/${sessionCode}`;
}

async function submitExam(sessionCode, manual = false) {
    if (examSubmitted) return;

    examSubmitted = true;
    try {
        await Promise.allSettled(snapshotAnswers());
        const response = await fetch(`/api/student/session/${sessionCode}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                reason: manual ? "Manual submission" : "Auto submission"
            })
        });

        const data = await response.json();
        window.location.href = data.redirect || `/student/submitted/${sessionCode}`;
    } catch (e) {
        console.error("Submit failed:", e);
        window.location.href = `/student/submitted/${sessionCode}`;
    }
}

function initWaitingPage(sessionCode) {
    currentSessionCode = sessionCode;

    setInterval(async () => {
        try {
            const res = await fetch(`/api/student/session/${sessionCode}/status`);
            const data = await res.json();

            if (data.exam_status === "active" && data.session_status !== "submitted") {
                window.location.href = `/student/exam/${sessionCode}`;
            }
        } catch (e) {
            console.error("Waiting poll failed:", e);
        }
    }, 3000);
}

function initExamPage(sessionCode, remainingSeconds) {
    currentSessionCode = sessionCode;
    let remaining = parseInt(remainingSeconds || "0", 10);

    const timerElement = document.getElementById("timer");
    const timerBox = document.querySelector(".timer-box");
    const gate = document.getElementById("fullscreenGate");

    enterFullscreen();

    function updateTimer() {
        if (timerElement) {
            timerElement.textContent = formatTime(remaining);
        }
        if (timerBox) {
            timerBox.classList.toggle("warning", remaining <= 300 && remaining > 60);
            timerBox.classList.toggle("danger", remaining <= 60);
        }
    }

    updateTimer();

    // Timer
    examTimerInterval = setInterval(() => {
        remaining -= 1;
        updateTimer();

        if (remaining <= 0 && !examSubmitted) {
            submitExam(sessionCode, false);
        }
    }, 1000);

    // Heartbeat
    heartbeatInterval = setInterval(() => {
        sendHeartbeat(sessionCode, document.hasFocus());
    }, 8000);

    // =============== ANTI-CHEATING MEASURES ===============

    // Keyboard shortcuts blocking
    document.addEventListener("keydown", function (e) {
        if (examSubmitted) return;

        const blocked =
            (e.ctrlKey && ["c", "x", "v", "s", "p", "u", "i", "r", "w", "n", "t"].includes(e.key.toLowerCase())) ||
            (e.metaKey && ["c", "x", "v", "s", "p", "u", "r", "w", "n", "t"].includes(e.key.toLowerCase())) ||
            e.key === "F12" ||
            (e.altKey && e.key === "F4") ||
            (e.altKey && e.key === "Tab") ||
            (e.ctrlKey && e.shiftKey && ["i", "j", "c", "k"].includes(e.key.toLowerCase()));

        if (blocked) {
            e.preventDefault();
            violationCount++;
            sendHeartbeat(sessionCode, false);
            return false;
        }
    });

    // Disable copy, cut, paste
    document.addEventListener("copy", e => e.preventDefault());
    document.addEventListener("cut", e => e.preventDefault());
    document.addEventListener("paste", e => e.preventDefault());

    // Disable right-click
    document.addEventListener("contextmenu", e => e.preventDefault());

    // Violation handler
    function handleViolation() {
        if (examSubmitted) return;
        violationCount++;
        sendHeartbeat(sessionCode, false);

        if (violationCount >= MAX_VIOLATIONS) {
            submitExam(sessionCode, false);
        }
    }

    // Visibility change, blur, fullscreen exit
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) handleViolation();
    });
    window.addEventListener("blur", handleViolation);

    document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement && !examSubmitted) {
            if (fullscreenReady) {
                submitExam(sessionCode, false);
            } else if (gate) {
                gate.classList.add("active");
            }
        }
    });

    // Refresh / close tab
    window.addEventListener("pagehide", () => {
        if (examSubmitted) return;
        try {
            const blob = new Blob([JSON.stringify({ reason: "Page closed" })], {
                type: "application/json"
            });
            navigator.sendBeacon(`/api/student/session/${sessionCode}/submit`, blob);
        } catch (e) {
            console.error(e);
        }
    });

    window.addEventListener("beforeunload", event => {
        if (examSubmitted) return;
        event.preventDefault();
        event.returnValue = "";
    });

    // Answer saving listeners
    document.querySelectorAll(".answer-field").forEach(field => {
        field.addEventListener("input", () => {
            queueTextSave(sessionCode, field.dataset.questionId, field.value);
        });
    });

    document.querySelectorAll(".answer-radio").forEach(radio => {
        radio.addEventListener("change", () => {
            saveAnswer(sessionCode, radio.dataset.questionId, radio.value);
        });
    });

    // Click anywhere to try fullscreen
    if (document.getElementById("questionList")) {
        document.getElementById("questionList").addEventListener("click", () => {
            if (!document.fullscreenElement) {
                enterFullscreen();
            }
        });
    }

    if (gate) {
        gate.classList.add("active");
        gate.querySelector("button")?.addEventListener("click", enterFullscreen);
    }
}
