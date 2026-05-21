let examTimerInterval = null;
let heartbeatInterval = null;
let debounceTimers = {};
let currentSessionCode = null;
let currentSessionToken = null;
let currentWindowToken = null;
let examSubmitted = false;
let violationCount = 0;
let fullscreenReady = false;
let MAX_WARNINGS = 3;
let questionStateMap = {};

const QUESTION_STATES = ["NOT_VISITED", "VISITED_UNANSWERED", "ANSWERED", "MARKED_REVIEW", "ANSWERED_MARKED"];

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

function examRequestHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (currentSessionToken) headers["X-Exam-Token"] = currentSessionToken;
    if (currentWindowToken) headers["X-Exam-Window-Token"] = currentWindowToken;
    return headers;
}

function examPayload(payload = {}) {
    return { ...payload, session_token: currentSessionToken, window_token: currentWindowToken };
}

function redirectIfLocked(data) {
    if (data?.redirect) {
        window.location.replace(data.redirect);
        return true;
    }
    return false;
}

function getWindowToken(sessionCode) {
    const key = `exam_window_token_${sessionCode}`;
    let token = sessionStorage.getItem(key);
    if (!token) {
        const random = new Uint8Array(24);
        if (window.crypto?.getRandomValues) {
            window.crypto.getRandomValues(random);
            token = Array.from(random, value => value.toString(16).padStart(2, "0")).join("");
        } else {
            token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
        }
        sessionStorage.setItem(key, token);
    }
    return token;
}

async function acquireExamWindowLock(sessionCode) {
    const response = await fetch(`/api/student/session/${sessionCode}/window-lock`, {
        method: "POST",
        headers: examRequestHeaders(),
        body: JSON.stringify(examPayload({}))
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
        redirectIfLocked(data);
        return false;
    }
    return true;
}

function normalizeQuestionState(status) {
    return QUESTION_STATES.includes(status) ? status : "NOT_VISITED";
}

function questionStatusClass(status) {
    return `status-${normalizeQuestionState(status).toLowerCase().replaceAll("_", "-")}`;
}

function getQuestionBlockById(questionId) {
    return document.querySelector(`[data-question-id="${questionId}"].student-question-card`);
}

function getQuestionPaletteItem(questionId) {
    return document.querySelector(`.palette-item[data-question-id="${questionId}"]`);
}

function getQuestionAnswerValue(questionBlock) {
    const checked = questionBlock.querySelector(".answer-radio:checked");
    if (checked) return checked.value.trim();

    const field = questionBlock.querySelector(".answer-field");
    return field ? field.value.trim() : "";
}

function isQuestionFlagged(questionBlock) {
    return questionBlock.querySelector(".flag-review-button")?.classList.contains("active") || false;
}

function computeQuestionState(questionBlock, markVisited = false) {
    const answered = getQuestionAnswerValue(questionBlock).length > 0;
    const flagged = isQuestionFlagged(questionBlock);
    const previous = normalizeQuestionState(questionBlock.dataset.visitStatus || "NOT_VISITED");
    const visited = markVisited || previous !== "NOT_VISITED";

    if (answered && flagged) return "ANSWERED_MARKED";
    if (answered) return "ANSWERED";
    if (flagged) return "MARKED_REVIEW";
    if (visited) return "VISITED_UNANSWERED";
    return "NOT_VISITED";
}

function getQuestionStatusCounts() {
    const counts = Object.fromEntries(QUESTION_STATES.map(state => [state, 0]));
    document.querySelectorAll(".student-question-card[data-question-id]").forEach(block => {
        counts[normalizeQuestionState(block.dataset.visitStatus)] += 1;
    });
    return counts;
}

function updateQuestionStatusSummary() {
    const counts = getQuestionStatusCounts();
    Object.entries(counts).forEach(([state, count]) => {
        const node = document.querySelector(`[data-summary="${state}"]`);
        if (node) node.textContent = count;
    });

    const answered = counts.ANSWERED + counts.ANSWERED_MARKED;
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const percent = total ? Math.round((answered / total) * 100) : 0;

    const answeredCount = document.getElementById("answeredCount");
    const totalCount = document.getElementById("totalQuestionCount");
    const progressFill = document.getElementById("answerProgressFill");
    const progressText = document.getElementById("answerProgressText");

    if (answeredCount) answeredCount.textContent = answered;
    if (totalCount) totalCount.textContent = total;
    if (progressFill) progressFill.style.width = `${percent}%`;
    if (progressText) progressText.textContent = `${percent}% complete`;
}

function applyQuestionState(questionBlock, state) {
    const normalized = normalizeQuestionState(state);
    const questionId = questionBlock.dataset.questionId;
    questionBlock.dataset.visitStatus = normalized;
    questionStateMap[questionId] = normalized;
    questionBlock.classList.toggle("answered", normalized === "ANSWERED" || normalized === "ANSWERED_MARKED");
    questionBlock.classList.toggle("marked-review", normalized === "MARKED_REVIEW" || normalized === "ANSWERED_MARKED");

    const item = getQuestionPaletteItem(questionId);
    if (item) {
        item.dataset.status = normalized;
        item.classList.remove(...QUESTION_STATES.map(questionStatusClass));
        item.classList.add(questionStatusClass(normalized));
    }

    updateQuestionStatusSummary();
}

async function persistQuestionState(sessionCode, questionId, state) {
    try {
        const response = await fetch(`/api/student/session/${sessionCode}/question-status`, {
            method: "POST",
            headers: examRequestHeaders(),
            body: JSON.stringify(examPayload({ question_id: questionId, visit_status: state }))
        });
        const data = await response.json();
        if (redirectIfLocked(data)) return;
        if (!response.ok || !data.ok) throw new Error(data.message || "Status save failed");
    } catch (error) {
        console.error("Question status save failed:", error);
    }
}

function updateQuestionState(questionBlock, markVisited = false, persist = false) {
    const state = computeQuestionState(questionBlock, markVisited);
    const changed = normalizeQuestionState(questionBlock.dataset.visitStatus) !== state;
    applyQuestionState(questionBlock, state);
    if (persist && changed) persistQuestionState(currentSessionCode, questionBlock.dataset.questionId, state);
    return state;
}

function refreshQuestionStates() {
    document.querySelectorAll(".student-question-card[data-question-id]").forEach(block => {
        applyQuestionState(block, normalizeQuestionState(block.dataset.visitStatus));
    });
}

async function saveAnswer(sessionCode, questionId, answerText, visitStatus = null) {
    updateAutoSaveStatus?.("saving");
    try {
        const response = await fetch(`/api/student/session/${sessionCode}/save`, {
            method: "POST",
            headers: examRequestHeaders(),
            body: JSON.stringify(examPayload({
                question_id: questionId,
                answer_text: answerText,
                visit_status: visitStatus || questionStateMap[questionId] || "ANSWERED"
            }))
        });
        const data = await response.json();
        if (redirectIfLocked(data)) return;
        if (!response.ok || !data.ok) {
            throw new Error(data.message || "Autosave failed");
        }
        updateAutoSaveStatus?.("saved");
    } catch (e) {
        console.error("Autosave failed:", e);
        updateAutoSaveStatus?.("error", "Check connection");
    }
}

function updateAnswerProgress() {
    const questionBlocks = Array.from(document.querySelectorAll(".student-question-card[data-question-number]"));
    if (!questionBlocks.length) return;

    questionBlocks.forEach(block => {
        updateQuestionState(block, false, false);
    });
}

function snapshotAnswers() {
    const saves = [];
    document.querySelectorAll(".answer-field").forEach(field => {
        const block = field.closest(".student-question-card");
        const state = block ? updateQuestionState(block, true, false) : questionStateMap[field.dataset.questionId];
        saves.push(saveAnswer(currentSessionCode, field.dataset.questionId, field.value, state));
    });
    document.querySelectorAll(".answer-radio:checked").forEach(radio => {
        const block = radio.closest(".student-question-card");
        const state = block ? updateQuestionState(block, true, false) : questionStateMap[radio.dataset.questionId];
        saves.push(saveAnswer(currentSessionCode, radio.dataset.questionId, radio.value, state));
    });
    return saves;
}

function isCodeEditingTarget(target) {
    return Boolean(target?.closest?.(".coding-workspace"));
}

function queueTextSave(sessionCode, questionId, answerText, visitStatus) {
    const key = `${sessionCode}_${questionId}`;
    if (debounceTimers[key]) clearTimeout(debounceTimers[key]);
    debounceTimers[key] = setTimeout(() => saveAnswer(sessionCode, questionId, answerText, visitStatus), 800);
}

async function runCodeForQuestion(button) {
    const questionId = button.dataset.questionId;
    const sessionCode = button.dataset.sessionCode;
    const workspace = button.closest(".coding-workspace");
    const codeField = workspace?.querySelector(".code-answer");
    const stdinField = workspace?.querySelector(".code-stdin");
    const outputPanel = document.getElementById(`code-output-${questionId}`);

    if (!codeField || !outputPanel) return;

    button.disabled = true;
    button.classList.add("loading");
    outputPanel.classList.add("running");
    outputPanel.textContent = "Running code...";

    try {
        await saveAnswer(sessionCode, questionId, codeField.value);
        const response = await fetch(`/api/student/session/${sessionCode}/execute`, {
            method: "POST",
            headers: examRequestHeaders(),
            body: JSON.stringify(examPayload({
                question_id: questionId,
                code: codeField.value,
                stdin: stdinField ? stdinField.value : "",
                visit_status: questionStateMap[questionId] || "ANSWERED"
            }))
        });
        const data = await response.json();
        if (redirectIfLocked(data)) return;
        const parts = [];
        parts.push(`[${(data.status || "unknown").toUpperCase()}] ${data.message || ""}`.trim());
        if (typeof data.execution_time_ms === "number") {
            parts.push(`Time: ${data.execution_time_ms} ms`);
        }
        if (data.stdout) {
            parts.push(`\nSTDOUT:\n${data.stdout}`);
        }
        if (data.stderr) {
            parts.push(`\nSTDERR:\n${data.stderr}`);
        }
        outputPanel.textContent = parts.join("\n");
        outputPanel.classList.toggle("success", data.status === "success");
        outputPanel.classList.toggle("error", data.status !== "success");
        updateAutoSaveStatus?.("saved", "Code run saved");
    } catch (error) {
        outputPanel.textContent = `Run failed: ${error.message || "Check connection"}`;
        outputPanel.classList.add("error");
        updateAutoSaveStatus?.("error", "Run failed");
    } finally {
        button.disabled = false;
        button.classList.remove("loading");
        outputPanel.classList.remove("running");
    }
}

async function sendHeartbeat(sessionCode, focused = true) {
    try {
        const response = await fetch(`/api/student/session/${sessionCode}/heartbeat`, {
            method: "POST",
            headers: examRequestHeaders(),
            body: JSON.stringify(examPayload({ focused, violation_count: violationCount }))
        });
        const data = await response.json();
        if (redirectIfLocked(data)) return;
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
        if (data.redirect && data.submitted) {
            window.location.replace(data.redirect);
            return;
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
            headers: examRequestHeaders(),
            body: JSON.stringify(examPayload({ type, detail, violation_count: violationCount }))
        });
        const data = await response.json();
        if (redirectIfLocked(data)) return data;
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
    window.location.replace(`/student/submitted/${sessionCode}`);
}

async function submitExam(sessionCode, manual = false, reason = null) {
    if (examSubmitted) return;
    examSubmitted = true;
    try {
        await Promise.allSettled(snapshotAnswers());
        const response = await fetch(`/api/student/session/${sessionCode}/submit`, {
            method: "POST",
            headers: examRequestHeaders(),
            body: JSON.stringify(examPayload({ reason: reason || (manual ? "Manual submission" : "Auto submission") }))
        });
        const data = await response.json();
        window.location.replace(data.redirect || `/student/submitted/${sessionCode}`);
    } catch (e) {
        console.error("Submit failed:", e);
        window.location.replace(`/student/submitted/${sessionCode}`);
    }
}

function confirmSubmitExam(sessionCode) {
    if (examSubmitted) return;
    updateAnswerProgress();
    const counts = getQuestionStatusCounts();
    const confirmed = window.confirm(
        [
            "Submit your exam now?",
            "",
            `Answered: ${counts.ANSWERED + counts.ANSWERED_MARKED}`,
            `Not answered: ${counts.VISITED_UNANSWERED}`,
            `Not visited: ${counts.NOT_VISITED}`,
            `Marked for review: ${counts.MARKED_REVIEW + counts.ANSWERED_MARKED}`,
            "",
            "Your saved answers will be sent before submission."
        ].join("\n")
    );
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

function initWaitingPage(sessionCode, sessionToken = null) {
    currentSessionCode = sessionCode;
    currentSessionToken = sessionToken;
    setInterval(async () => {
        try {
            const res = await fetch(`/api/student/session/${sessionCode}/status`, {
                headers: currentSessionToken ? { "X-Exam-Token": currentSessionToken } : {}
            });
            const data = await res.json();
            if (redirectIfLocked(data)) return;
            if (data.redirect && data.submitted) {
                window.location.replace(data.redirect);
                return;
            }
            if (data.exam_status === "active" && data.time_state !== "not_started" && data.session_status !== "submitted") {
                window.location.replace(`/student/precheck/${sessionCode}`);
            }
        } catch (e) {
            console.error("Waiting poll failed:", e);
        }
    }, 3000);
}

async function initExamPage(sessionCode, remainingSeconds, sessionToken = null) {
    currentSessionCode = sessionCode;
    currentSessionToken = sessionToken;
    currentWindowToken = getWindowToken(sessionCode);
    if (!(await acquireExamWindowLock(sessionCode))) return;

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
            if (data.redirect) {
                window.location.replace(data.redirect);
            } else {
                forceSubmit(sessionCode);
            }
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
        const editingCode = isCodeEditingTarget(e.target);
        const codeAllowedShortcut = editingCode && (e.ctrlKey || e.metaKey) && ["a", "c", "v", "x"].includes(key);
        const blocked =
            !codeAllowedShortcut && (
            (e.ctrlKey && ["a", "c", "x", "v", "s", "p", "u", "i", "r", "w", "n", "t"].includes(key)) ||
            (e.metaKey && ["a", "c", "x", "v", "s", "p", "u", "r", "w", "n", "t"].includes(key)) ||
            e.key === "F12" ||
            (e.altKey && e.key === "F4") ||
            (e.altKey && e.key === "Tab") ||
            (e.ctrlKey && e.shiftKey && ["i", "j", "c", "k"].includes(key)));
        if (blocked) {
            e.preventDefault();
            registerViolation(sessionCode, "Blocked shortcut", "This keyboard shortcut is disabled during the exam.");
            return false;
        }
    });

    document.addEventListener("copy", e => {
        if (isCodeEditingTarget(e.target)) return;
        e.preventDefault();
        registerViolation(sessionCode, "Copy blocked", "Copy is disabled during exams.");
    });
    document.addEventListener("cut", e => {
        if (isCodeEditingTarget(e.target)) return;
        e.preventDefault();
        registerViolation(sessionCode, "Cut blocked", "Cut is disabled during exams.");
    });
    document.addEventListener("paste", e => {
        if (isCodeEditingTarget(e.target)) return;
        e.preventDefault();
        registerViolation(sessionCode, "Paste blocked", "Paste is disabled during exams.");
    });
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
                violation_count: attempts,
                session_token: currentSessionToken,
                window_token: currentWindowToken
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
                violation_count: attempts,
                session_token: currentSessionToken,
                window_token: currentWindowToken
            })], { type: "application/json" });
            navigator.sendBeacon(`/api/student/session/${sessionCode}/violation`, blob);
        }
    });

    document.querySelectorAll(".answer-field").forEach(field => {
        field.addEventListener("input", () => {
            const block = field.closest(".student-question-card");
            const state = block ? updateQuestionState(block, true, false) : "ANSWERED";
            queueTextSave(sessionCode, field.dataset.questionId, field.value, state);
        });
    });
    document.querySelectorAll(".answer-radio").forEach(radio => {
        radio.addEventListener("change", () => {
            const block = radio.closest(".student-question-card");
            const state = block ? updateQuestionState(block, true, false) : "ANSWERED";
            saveAnswer(sessionCode, radio.dataset.questionId, radio.value, state);
        });
    });
    document.querySelectorAll(".flag-review-button").forEach(button => {
        button.addEventListener("click", () => {
            const block = button.closest(".student-question-card");
            if (!block) return;
            button.classList.toggle("active");
            updateQuestionState(block, true, true);
        });
    });
    document.querySelectorAll(".run-code-button").forEach(button => {
        button.addEventListener("click", () => runCodeForQuestion(button));
    });

    document.getElementById("questionPalette")?.addEventListener("click", event => {
        const item = event.target.closest(".palette-item");
        if (!item) return;
        scrollToQuestion?.(item.dataset.question);
        const block = getQuestionBlockById(item.dataset.questionId);
        if (block) updateQuestionState(block, true, true);
    });

    document.getElementById("questionList")?.addEventListener("click", () => {
        if (!document.fullscreenElement) enterFullscreen();
    });

    if (gate) {
        gate.classList.add("active");
        gate.querySelector("button")?.addEventListener("click", enterFullscreen);
    }

    if ("IntersectionObserver" in window) {
        const observer = new IntersectionObserver(entries => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    updateQuestionState(entry.target, true, true);
                }
            });
        }, { threshold: 0.55 });
        document.querySelectorAll(".student-question-card[data-question-id]").forEach(block => observer.observe(block));
    }

    refreshQuestionStates();
    updateAnswerProgress();
    updateAutoSaveStatus?.("idle");
}
