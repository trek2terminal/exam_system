let examTimerInterval = null;
let heartbeatInterval = null;
let debounceTimers = {};
let currentSessionCode = null;
let examSubmitted = false;
let violationCount = 0;
let fullscreenReady = false;
let MAX_WARNINGS = 3;

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
    if (h > 0) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

async function saveAnswer(sessionCode, questionId, answerText) {
    updateAutoSaveStatus?.("saving");
    try {
        const response = await fetch(`/api/student/session/${sessionCode}/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question_id: questionId, answer_text: answerText })
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
            throw new Error(data.message || "Autosave failed");
        }
        updateAutoSaveStatus?.("saved");
    } catch (e) {
        console.error("Autosave failed:", e);
        updateAutoSaveStatus?.("error", "Check connection");
    }
}

function getQuestionAnswerValue(questionBlock) {
    const checked = questionBlock.querySelector(".answer-radio:checked");
    if (checked) return checked.value.trim();

    const field = questionBlock.querySelector(".answer-field");
    return field ? field.value.trim() : "";
}

function updateAnswerProgress() {
    const questionBlocks = Array.from(document.querySelectorAll("[data-question-number]"));
    if (!questionBlocks.length) return;

    let answered = 0;
    questionBlocks.forEach(block => {
        const isAnswered = getQuestionAnswerValue(block).length > 0;
        const questionNumber = block.dataset.questionNumber;
        if (isAnswered) answered += 1;
        block.classList.toggle("answered", isAnswered);
        updatePaletteStatus?.(questionNumber, isAnswered ? "answered" : "");
    });

    const answeredCount = document.getElementById("answeredCount");
    const totalCount = document.getElementById("totalQuestionCount");
    const progressFill = document.getElementById("answerProgressFill");
    const progressText = document.getElementById("answerProgressText");
    const percent = Math.round((answered / questionBlocks.length) * 100);

    if (answeredCount) answeredCount.textContent = answered;
    if (totalCount) totalCount.textContent = questionBlocks.length;
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressText) progressText.textContent = `${percent}% complete`;
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
    debounceTimers[key] = setTimeout(() => saveAnswer(sessionCode, questionId, answerText), 800);
}

async function sendHeartbeat(sessionCode, focused = true) {
    try {
        const response = await fetch(`/api/student/session/${sessionCode}/heartbeat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ focused, violation_count: violationCount })
        });
        const data = await response.json();
        if (typeof data.max_violations_allowed === "number") {
            MAX_WARNINGS = data.max_violations_allowed;
        }
        if (typeof data.focus_violations === "number") {
            violationCount = data.focus_violations;
            updateWarningHud();
        }
        if (typeof window.syncExamStatus === "function") {
            window.syncExamStatus(data);
        }
        if (data.submitted && !examSubmitted) forceSubmit(sessionCode);
    } catch (e) {
        console.error("Heartbeat failed:", e);
    }
}

async function reportViolation(sessionCode, type, detail) {
    try {
        const response = await fetch(`/api/student/session/${sessionCode}/violation`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, detail, violation_count: violationCount })
        });
        const data = await response.json();
        if (typeof data.max_violations_allowed === "number") {
            MAX_WARNINGS = data.max_violations_allowed;
        }
        if (typeof data.focus_violations === "number") {
            violationCount = data.focus_violations;
            updateWarningHud();
        }
        return data;
    } catch (e) {
        console.error("Violation report failed:", e);
        return null;
    }
}

function forceSubmit(sessionCode) {
    if (examSubmitted) return;
    examSubmitted = true;
    window.location.href = `/student/submitted/${sessionCode}`;
}

async function submitExam(sessionCode, manual = false, reason = null) {
    if (examSubmitted) return;
    examSubmitted = true;
    try {
        await Promise.allSettled(snapshotAnswers());
        const response = await fetch(`/api/student/session/${sessionCode}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: reason || (manual ? "Manual submission" : "Auto submission") })
        });
        const data = await response.json();
        window.location.href = data.redirect || `/student/submitted/${sessionCode}`;
    } catch (e) {
        console.error("Submit failed:", e);
        window.location.href = `/student/submitted/${sessionCode}`;
    }
}

function confirmSubmitExam(sessionCode) {
    if (examSubmitted) return;
    const confirmed = window.confirm("Submit your exam now? Your saved answers will be sent before submission.");
    if (confirmed) submitExam(sessionCode, true, "Manual submission");
}

function updateWarningHud() {
    const warningCount = document.getElementById("warningCount");
    const warningLimit = document.getElementById("warningLimit");
    const warningDots = document.querySelectorAll("#warningDots span");
    const count = Math.min(violationCount, MAX_WARNINGS);
    if (warningCount) warningCount.textContent = count;
    if (warningLimit) warningLimit.textContent = MAX_WARNINGS;
    warningDots.forEach((dot, index) => dot.classList.toggle("active", index < count));
}

function playWarningSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(420 + Math.min(violationCount, MAX_WARNINGS) * 45, context.currentTime);
        gain.gain.setValueAtTime(0.001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.045, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.22);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.24);
        setTimeout(() => context.close(), 320);
    } catch (e) {
        console.warn("Warning sound blocked by browser", e);
    }
}

function showProctorWarning(type, message) {
    const overlay = document.getElementById("proctorWarning");
    const title = document.getElementById("proctorWarningTitle");
    const body = document.getElementById("proctorWarningMessage");
    const progress = document.getElementById("proctorWarningProgress");
    if (!overlay || !title || !body || !progress) return;
    title.textContent = type;
    body.textContent = message;
    progress.style.width = `${Math.min(100, (violationCount / MAX_WARNINGS) * 100)}%`;
    overlay.classList.remove("level-1", "level-2", "level-3", "level-4", "level-5");
    overlay.classList.add(`level-${Math.min(violationCount, MAX_WARNINGS)}`);
    overlay.classList.add("active");
    overlay.setAttribute("aria-hidden", "false");
    clearTimeout(overlay.dismissTimer);
    overlay.dismissTimer = setTimeout(() => {
        overlay.classList.remove("active");
        overlay.setAttribute("aria-hidden", "true");
    }, 2600);
}

function registerViolation(sessionCode, type, detail) {
    if (examSubmitted) return;
    violationCount += 1;
    updateWarningHud();
    playWarningSound();
    reportViolation(sessionCode, type, detail);

    const remaining = Math.max(MAX_WARNINGS - violationCount, 0);
    const suffix = remaining > 1
        ? `${remaining} warnings left. Stay in this exam window.`
        : remaining === 1
            ? "Final warning. The next violation will require admin review."
            : "Your session has been flagged for admin review. Continue only inside this exam window.";
    showProctorWarning(type, `${detail} ${suffix}`);
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
    const shell = document.querySelector(".exam-shell");
    const configuredLimit = parseInt(shell?.dataset.warningLimit || "3", 10);
    if (configuredLimit > 0) MAX_WARNINGS = configuredLimit;

    const closeAttemptKey = `exam_close_attempts_${sessionCode}`;
    localStorage.removeItem(closeAttemptKey);
    let remaining = parseInt(remainingSeconds || "0", 10);
    const timerElement = document.getElementById("timer");
    const timerBox = document.querySelector(".timer-box");
    const gate = document.getElementById("fullscreenGate");

    enterFullscreen();
    updateWarningHud();

    function updateTimer() {
        if (timerElement) timerElement.textContent = formatTime(remaining);
        if (timerBox) {
            timerBox.classList.toggle("warning", remaining <= 300 && remaining > 60);
            timerBox.classList.toggle("danger", remaining <= 60);
        }
    }

    window.syncExamStatus = data => {
        if (typeof data.remaining_seconds === "number" && Math.abs(data.remaining_seconds - remaining) > 2) {
            remaining = data.remaining_seconds;
            updateTimer();
        }
        if (data.session_status === "submitted" || data.session_status === "evaluated" || data.submitted) {
            forceSubmit(sessionCode);
        }
    };

    updateTimer();
    examTimerInterval = setInterval(() => {
        remaining -= 1;
        updateTimer();
        if (remaining <= 0 && !examSubmitted) submitExam(sessionCode, false, "Time expired");
    }, 1000);

    heartbeatInterval = setInterval(() => sendHeartbeat(sessionCode, document.hasFocus()), 8000);

    document.addEventListener("keydown", e => {
        if (examSubmitted) return;
        if (e.key === "Escape") {
            e.preventDefault();
            registerViolation(sessionCode, "Fullscreen exit attempt", "Escape is not allowed during the exam.");
            return false;
        }
        const key = e.key.toLowerCase();
        const blocked =
            (e.ctrlKey && ["c", "x", "v", "s", "p", "u", "i", "r", "w", "n", "t"].includes(key)) ||
            (e.metaKey && ["c", "x", "v", "s", "p", "u", "r", "w", "n", "t"].includes(key)) ||
            e.key === "F12" ||
            (e.altKey && e.key === "F4") ||
            (e.altKey && e.key === "Tab") ||
            (e.ctrlKey && e.shiftKey && ["i", "j", "c", "k"].includes(key));
        if (blocked) {
            e.preventDefault();
            registerViolation(sessionCode, "Blocked shortcut", "This keyboard shortcut is disabled during the exam.");
            return false;
        }
    });

    document.addEventListener("copy", e => { e.preventDefault(); registerViolation(sessionCode, "Copy blocked", "Copy is disabled during exams."); });
    document.addEventListener("cut", e => { e.preventDefault(); registerViolation(sessionCode, "Cut blocked", "Cut is disabled during exams."); });
    document.addEventListener("paste", e => { e.preventDefault(); registerViolation(sessionCode, "Paste blocked", "Paste is disabled during exams."); });
    document.addEventListener("contextmenu", e => { e.preventDefault(); registerViolation(sessionCode, "Right-click blocked", "Right-click is disabled during exams."); });

    document.addEventListener("visibilitychange", () => {
        if (document.hidden) registerViolation(sessionCode, "Tab switch", "Tab switch was detected.");
    });
    window.addEventListener("blur", () => registerViolation(sessionCode, "Window lost focus", "Window lost focus was detected."));

    document.addEventListener("fullscreenchange", () => {
        if (!document.fullscreenElement && !examSubmitted) {
            if (fullscreenReady) {
                registerViolation(sessionCode, "Fullscreen exited", "Fullscreen exit was detected.");
                if (violationCount <= MAX_WARNINGS) setTimeout(enterFullscreen, 400);
            } else if (gate) {
                gate.classList.add("active");
            }
        }
    });

    window.addEventListener("beforeunload", event => {
        if (examSubmitted) return;
        const attempts = parseInt(localStorage.getItem(closeAttemptKey) || "0", 10) + 1;
        localStorage.setItem(closeAttemptKey, String(attempts));
        if (attempts >= MAX_WARNINGS) {
            const blob = new Blob([JSON.stringify({
                type: "PAGE_CLOSE_ATTEMPT",
                detail: "Repeated page close/refresh attempts",
                violation_count: attempts
            })], { type: "application/json" });
            navigator.sendBeacon(`/api/student/session/${sessionCode}/violation`, blob);
            return;
        }
        event.preventDefault();
        event.returnValue = "";
        return "";
    });

    window.addEventListener("pagehide", () => {
        if (examSubmitted) return;
        const attempts = parseInt(localStorage.getItem(closeAttemptKey) || "0", 10);
        if (attempts >= MAX_WARNINGS) {
            const blob = new Blob([JSON.stringify({
                type: "PAGE_CLOSE_ATTEMPT",
                detail: "Repeated page close/refresh attempts",
                violation_count: attempts
            })], { type: "application/json" });
            navigator.sendBeacon(`/api/student/session/${sessionCode}/violation`, blob);
        }
    });

    document.querySelectorAll(".answer-field").forEach(field => {
        field.addEventListener("input", () => {
            queueTextSave(sessionCode, field.dataset.questionId, field.value);
            updateAnswerProgress();
        });
    });
    document.querySelectorAll(".answer-radio").forEach(radio => {
        radio.addEventListener("change", () => {
            saveAnswer(sessionCode, radio.dataset.questionId, radio.value);
            updateAnswerProgress();
        });
    });

    document.getElementById("questionPalette")?.addEventListener("click", event => {
        const item = event.target.closest(".palette-item");
        if (!item) return;
        scrollToQuestion?.(item.dataset.question);
    });

    document.getElementById("questionList")?.addEventListener("click", () => {
        if (!document.fullscreenElement) enterFullscreen();
    });

    if (gate) {
        gate.classList.add("active");
        gate.querySelector("button")?.addEventListener("click", enterFullscreen);
    }

    updateAnswerProgress();
    updateAutoSaveStatus?.("idle");
}
