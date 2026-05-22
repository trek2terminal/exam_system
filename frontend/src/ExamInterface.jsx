/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import {
  AlertTriangle,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Expand,
  Play,
  Send,
  ShieldAlert,
  TerminalSquare
} from "lucide-react";
import { api } from "./services/api";

const QUESTION_STATES = [
  "NOT_VISITED",
  "VISITED_UNANSWERED",
  "ANSWERED",
  "MARKED_REVIEW",
  "ANSWERED_MARKED"
];

function formatExamTime(seconds) {
  const safeSeconds = Math.max(Math.floor(seconds || 0), 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function getWindowToken(sessionCode) {
  const key = `react_exam_window_${sessionCode}`;
  let token = window.sessionStorage.getItem(key);
  if (!token) {
    const random = new Uint8Array(24);
    if (window.crypto?.getRandomValues) {
      window.crypto.getRandomValues(random);
      token = Array.from(random, value => value.toString(16).padStart(2, "0")).join("");
    } else {
      token = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
    window.sessionStorage.setItem(key, token);
  }
  return token;
}

function normalizeStatus(status) {
  return QUESTION_STATES.includes(status) ? status : "NOT_VISITED";
}

function isAnswered(status) {
  return status === "ANSWERED" || status === "ANSWERED_MARKED";
}

function isFlagged(status) {
  return status === "MARKED_REVIEW" || status === "ANSWERED_MARKED";
}

function computeStatus(answerText, flagged, visited = true) {
  const answered = String(answerText || "").trim().length > 0;
  if (answered && flagged) return "ANSWERED_MARKED";
  if (answered) return "ANSWERED";
  if (flagged) return "MARKED_REVIEW";
  return visited ? "VISITED_UNANSWERED" : "NOT_VISITED";
}

function statusLabel(status) {
  return normalizeStatus(status).replaceAll("_", " ").toLowerCase();
}

function isoDeadlineToMs(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

export default function ExamInterface() {
  const { sessionCode } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [examState, setExamState] = useState(null);
  const [sessionToken, setSessionToken] = useState("");
  const [windowToken, setWindowToken] = useState("");
  const [answers, setAnswers] = useState({});
  const [statuses, setStatuses] = useState({});
  const [outputs, setOutputs] = useState({});
  const [stdinValues, setStdinValues] = useState({});
  const [questionDeadlines, setQuestionDeadlines] = useState({});
  const [expiredQuestions, setExpiredQuestions] = useState({});
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [clockTick, setClockTick] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [autosaveState, setAutosaveState] = useState("Ready");
  const [violationCount, setViolationCount] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [runningQuestionId, setRunningQuestionId] = useState(null);
  const [fullscreenPrompt, setFullscreenPrompt] = useState(true);
  const saveTimers = useRef({});
  const submittedRef = useRef(false);

  const questions = examState?.questions || [];
  const currentQuestion = questions[currentIndex];
  const warningLimit = examState?.max_violations_allowed || 3;

  const requestHeaders = useCallback(() => ({
    "X-Exam-Token": sessionToken,
    "X-Exam-Window-Token": windowToken
  }), [sessionToken, windowToken]);

  const requestPayload = useCallback((payload = {}) => ({
    ...payload,
    session_token: sessionToken,
    window_token: windowToken
  }), [sessionToken, windowToken]);

  const redirectFromPayload = useCallback(payload => {
    if (payload?.redirect) {
      window.location.replace(payload.redirect);
      return true;
    }
    return false;
  }, []);

  const loadAttempt = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await api.get(`/student/session/${sessionCode}/exam-state`);
      if (redirectFromPayload(data)) return;
      const nextWindowToken = getWindowToken(sessionCode);
      setExamState(data);
      setSessionToken(data.attempt_token);
      setWindowToken(nextWindowToken);
      setRemainingSeconds(data.remaining_seconds || 0);
      setViolationCount(data.student_session?.focus_violations || 0);
      setPaused(data.student_session?.status === "paused");

      const nextAnswers = {};
      const nextStatuses = {};
      const nextOutputs = {};
      const nextStdinValues = {};
      const nextDeadlines = {};
      const nextExpired = {};
      data.questions.forEach(question => {
        nextAnswers[question.id] = question.answer?.answer_text || "";
        nextStatuses[question.id] = normalizeStatus(question.answer?.visit_status);
        nextOutputs[question.id] = question.answer?.code_output || "";
        nextStdinValues[question.id] = "";
        nextExpired[question.id] = Boolean(question.answer?.question_time_expired);
        const deadline = isoDeadlineToMs(question.answer?.question_expires_at);
        if (deadline) nextDeadlines[question.id] = deadline;
      });
      setAnswers(nextAnswers);
      setStatuses(nextStatuses);
      setOutputs(nextOutputs);
      setStdinValues(nextStdinValues);
      setQuestionDeadlines(nextDeadlines);
      setExpiredQuestions(nextExpired);
    } catch (err) {
      if (redirectFromPayload(err.response?.data)) return;
      setError(err.response?.data?.message || err.message || "Could not load this exam attempt.");
    } finally {
      setLoading(false);
    }
  }, [sessionCode, redirectFromPayload]);

  const acquireWindowLock = useCallback(async () => {
    if (!sessionToken || !windowToken) return;
    try {
      const { data } = await api.post(
        `/student/session/${sessionCode}/window-lock`,
        requestPayload({}),
        { headers: requestHeaders() }
      );
      redirectFromPayload(data);
    } catch (err) {
      if (!redirectFromPayload(err.response?.data)) {
        setError(err.response?.data?.message || "This exam is already open in another window.");
      }
    }
  }, [sessionCode, sessionToken, windowToken, requestHeaders, requestPayload, redirectFromPayload]);

  const saveQuestionStatus = useCallback(async (questionId, visitStatus) => {
    if (!sessionToken || !windowToken) return;
    try {
      const { data } = await api.post(
        `/student/session/${sessionCode}/question-status`,
        requestPayload({ question_id: questionId, visit_status: visitStatus }),
        { headers: requestHeaders() }
      );
      redirectFromPayload(data);
    } catch (err) {
      setAutosaveState(err.response?.data?.message || "Status save failed");
    }
  }, [sessionCode, sessionToken, windowToken, requestHeaders, requestPayload, redirectFromPayload]);

  const saveAnswerNow = useCallback(async (questionId, answerText, visitStatus) => {
    if (!sessionToken || !windowToken || paused || expiredQuestions[questionId]) return;
    setAutosaveState("Saving...");
    try {
      const { data } = await api.post(
        `/student/session/${sessionCode}/save`,
        requestPayload({ question_id: questionId, answer_text: answerText, visit_status: visitStatus }),
        { headers: requestHeaders() }
      );
      if (redirectFromPayload(data)) return;
      setAutosaveState("Saved just now");
    } catch (err) {
      setAutosaveState(err.response?.data?.message || "Save failed, retrying");
      if (!window.navigator.onLine || !err.response) {
        const key = `react_exam_buffer_${sessionCode}`;
        const queue = JSON.parse(window.localStorage.getItem(key) || "{}");
        queue[questionId] = { question_id: questionId, answer_text: answerText, visit_status: visitStatus };
        window.localStorage.setItem(key, JSON.stringify(queue));
      }
    }
  }, [sessionCode, sessionToken, windowToken, paused, expiredQuestions, requestHeaders, requestPayload, redirectFromPayload]);

  const scheduleSave = useCallback((questionId, answerText, visitStatus) => {
    if (saveTimers.current[questionId]) {
      window.clearTimeout(saveTimers.current[questionId]);
    }
    saveTimers.current[questionId] = window.setTimeout(() => {
      saveAnswerNow(questionId, answerText, visitStatus);
    }, 700);
  }, [saveAnswerNow]);

  const setQuestionStatus = useCallback((questionId, answerText, flagged, persist = true) => {
    const nextStatus = computeStatus(answerText, flagged, true);
    setStatuses(current => ({ ...current, [questionId]: nextStatus }));
    if (persist) saveQuestionStatus(questionId, nextStatus);
    return nextStatus;
  }, [saveQuestionStatus]);

  const updateAnswer = useCallback((question, value) => {
    const previousStatus = normalizeStatus(statuses[question.id]);
    const flagged = isFlagged(previousStatus);
    const nextStatus = computeStatus(value, flagged, true);
    setAnswers(current => ({ ...current, [question.id]: value }));
    setStatuses(current => ({ ...current, [question.id]: nextStatus }));
    scheduleSave(question.id, value, nextStatus);
  }, [statuses, scheduleSave]);

  const visitQuestion = useCallback(index => {
    const question = questions[index];
    if (!question) return;
    setCurrentIndex(index);
    if (question.time_limit_seconds > 0 && !expiredQuestions[question.id]) {
      setQuestionDeadlines(current => {
        if (current[question.id]) return current;
        return { ...current, [question.id]: Date.now() + question.time_limit_seconds * 1000 };
      });
    }
    const status = normalizeStatus(statuses[question.id]);
    if (status === "NOT_VISITED") {
      const nextStatus = computeStatus(answers[question.id], false, true);
      setStatuses(current => ({ ...current, [question.id]: nextStatus }));
      saveQuestionStatus(question.id, nextStatus);
    }
  }, [questions, statuses, answers, expiredQuestions, saveQuestionStatus]);

  const toggleFlag = useCallback(question => {
    const currentStatus = normalizeStatus(statuses[question.id]);
    const nextFlagged = !isFlagged(currentStatus);
    const answerText = answers[question.id] || "";
    const nextStatus = setQuestionStatus(question.id, answerText, nextFlagged, true);
    setStatuses(current => ({ ...current, [question.id]: nextStatus }));
  }, [answers, statuses, setQuestionStatus]);

  const reportViolation = useCallback((type, detail) => {
    if (!sessionToken || !windowToken || submittedRef.current || paused) return;
    setViolationCount(current => {
      const nextCount = current + 1;
      api.post(
        `/student/session/${sessionCode}/violation`,
        requestPayload({ type, detail, violation_count: nextCount }),
        { headers: requestHeaders() }
      ).then(({ data }) => {
        if (redirectFromPayload(data)) return;
        if (typeof data.focus_violations === "number") setViolationCount(data.focus_violations);
      }).catch(() => {});
      return nextCount;
    });
  }, [sessionCode, sessionToken, windowToken, paused, requestHeaders, requestPayload, redirectFromPayload]);

  const sendHeartbeat = useCallback(async () => {
    if (!sessionToken || !windowToken || submittedRef.current) return;
    try {
      const { data } = await api.post(
        `/student/session/${sessionCode}/heartbeat`,
        requestPayload({ focused: document.hasFocus(), violation_count: violationCount }),
        { headers: requestHeaders() }
      );
      if (redirectFromPayload(data)) return;
      if (typeof data.remaining_seconds === "number") setRemainingSeconds(data.remaining_seconds);
      if (typeof data.focus_violations === "number") setViolationCount(data.focus_violations);
      setPaused(Boolean(data.paused));
      if (data.submitted && data.redirect) window.location.replace(data.redirect);
    } catch {
      setAutosaveState("Connection unstable");
    }
  }, [sessionCode, sessionToken, windowToken, violationCount, requestHeaders, requestPayload, redirectFromPayload]);

  const flushOfflineQueue = useCallback(async () => {
    if (!sessionToken || !windowToken || paused) return;
    const key = `react_exam_buffer_${sessionCode}`;
    const queue = JSON.parse(window.localStorage.getItem(key) || "{}");
    const entries = Object.values(queue);
    if (!entries.length) return;
    setAutosaveState("Syncing...");
    for (const entry of entries) {
      await saveAnswerNow(entry.question_id, entry.answer_text, entry.visit_status);
      delete queue[entry.question_id];
      window.localStorage.setItem(key, JSON.stringify(queue));
    }
    setAutosaveState("Synced");
  }, [sessionCode, sessionToken, windowToken, paused, saveAnswerNow]);

  const submitExam = useCallback(async (reason = "Manual submission") => {
    if (submittedRef.current || !sessionToken || !windowToken) return;
    submittedRef.current = true;
    setSubmitting(true);
    try {
      await Promise.allSettled(
        Object.entries(saveTimers.current).map(([questionId, timerId]) => {
          window.clearTimeout(timerId);
          const status = normalizeStatus(statuses[questionId]);
          return saveAnswerNow(questionId, answers[questionId] || "", status);
        })
      );
      const { data } = await api.post(
        `/student/session/${sessionCode}/submit`,
        requestPayload({ reason }),
        { headers: requestHeaders() }
      );
      window.location.replace(data.redirect || examState?.student_session?.submitted_url || "/student/dashboard");
    } catch {
      window.location.replace(examState?.student_session?.submitted_url || "/student/dashboard");
    }
  }, [sessionCode, sessionToken, windowToken, statuses, answers, saveAnswerNow, requestHeaders, requestPayload, examState]);

  const confirmSubmit = useCallback(() => {
    const answered = Object.values(statuses).filter(isAnswered).length;
    const flagged = Object.values(statuses).filter(isFlagged).length;
    const notVisited = Object.values(statuses).filter(status => status === "NOT_VISITED").length;
    const confirmed = window.confirm(
      [
        "Submit your exam now?",
        "",
        `Answered: ${answered}`,
        `Marked for review: ${flagged}`,
        `Not visited: ${notVisited}`,
        "",
        "Your saved answers will be sent before final submission."
      ].join("\n")
    );
    if (confirmed) submitExam("Manual submission");
  }, [statuses, submitExam]);

  const runCode = useCallback(async question => {
    if (expiredQuestions[question.id]) return;
    const code = answers[question.id] || "";
    const stdin = stdinValues[question.id] || "";
    const nextStatus = computeStatus(code, isFlagged(statuses[question.id]), true);
    setRunningQuestionId(question.id);
    setOutputs(current => ({ ...current, [question.id]: "Running..." }));
    await saveAnswerNow(question.id, code, nextStatus);
    try {
      const { data } = await api.post(
        `/student/session/${sessionCode}/execute`,
        requestPayload({ question_id: question.id, code, stdin, visit_status: nextStatus }),
        { headers: requestHeaders() }
      );
      if (redirectFromPayload(data)) return;
      const parts = [`[${(data.status || "unknown").toUpperCase()}] ${data.message || ""}`];
      if (typeof data.execution_time_ms === "number") parts.push(`Time: ${data.execution_time_ms} ms`);
      if (data.stdout) parts.push(`\nSTDOUT:\n${data.stdout}`);
      if (data.stderr) parts.push(`\nSTDERR:\n${data.stderr}`);
      setOutputs(current => ({ ...current, [question.id]: parts.join("\n") }));
      setAutosaveState("Code run saved");
    } catch (err) {
      setOutputs(current => ({ ...current, [question.id]: err.response?.data?.message || "Run failed" }));
      setAutosaveState("Run failed");
    } finally {
      setRunningQuestionId(null);
    }
  }, [answers, statuses, stdinValues, expiredQuestions, sessionCode, requestHeaders, requestPayload, redirectFromPayload, saveAnswerNow]);

  const expireQuestion = useCallback(async question => {
    if (!question || expiredQuestions[question.id]) return;
    setExpiredQuestions(current => ({ ...current, [question.id]: true }));
    const answerText = answers[question.id] || "";
    const visitStatus = computeStatus(answerText, isFlagged(statuses[question.id]), true);
    setAutosaveState("Question time expired");
    try {
      await saveAnswerNow(question.id, answerText, visitStatus);
      const { data } = await api.post(
        `/student/session/${sessionCode}/question-expired`,
        requestPayload({ question_id: question.id, answer_text: answerText, visit_status: visitStatus }),
        { headers: requestHeaders() }
      );
      redirectFromPayload(data);
    } catch {
      setAutosaveState("Question expiry sync failed");
    }
    if (currentQuestion?.id === question.id && currentIndex < questions.length - 1) {
      visitQuestion(currentIndex + 1);
    }
  }, [
    answers,
    statuses,
    expiredQuestions,
    sessionCode,
    currentQuestion,
    currentIndex,
    questions.length,
    saveAnswerNow,
    requestHeaders,
    requestPayload,
    redirectFromPayload,
    visitQuestion
  ]);

  const enterFullscreen = useCallback(async () => {
    try {
      await document.documentElement.requestFullscreen?.();
      setFullscreenPrompt(false);
    } catch {
      setFullscreenPrompt(true);
    }
  }, []);

  const counts = useMemo(() => {
    const nextCounts = Object.fromEntries(QUESTION_STATES.map(state => [state, 0]));
    questions.forEach(question => {
      const status = normalizeStatus(statuses[question.id]);
      nextCounts[status] += 1;
    });
    return nextCounts;
  }, [questions, statuses]);

  const answeredCount = counts.ANSWERED + counts.ANSWERED_MARKED;
  const progressPercent = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;
  const currentQuestionDeadline = currentQuestion ? questionDeadlines[currentQuestion.id] : null;
  const currentQuestionRemaining = currentQuestion?.time_limit_seconds
    ? currentQuestionDeadline
      ? Math.max(Math.ceil((currentQuestionDeadline - Date.now()) / 1000), 0)
      : currentQuestion.time_limit_seconds
    : null;

  useEffect(() => {
    loadAttempt();
  }, [loadAttempt]);

  useEffect(() => {
    acquireWindowLock();
  }, [acquireWindowLock]);

  useEffect(() => {
    if (!currentQuestion) return;
    visitQuestion(currentIndex);
  }, [currentIndex, currentQuestion?.id]);

  useEffect(() => {
    if (!sessionToken || !windowToken) return;
    const intervalId = window.setInterval(sendHeartbeat, 8000);
    return () => window.clearInterval(intervalId);
  }, [sessionToken, windowToken, sendHeartbeat]);

  useEffect(() => {
    if (!sessionToken || !windowToken || submitting) return;
    const intervalId = window.setInterval(() => {
      setRemainingSeconds(current => {
        if (paused) return current;
        setClockTick(value => value + 1);
        const nextValue = Math.max(current - 1, 0);
        if (nextValue === 0) submitExam("Time expired");
        return nextValue;
      });
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [sessionToken, windowToken, submitting, paused, submitExam]);

  useEffect(() => {
    if (!sessionToken || !windowToken || paused) return;
    questions.forEach(question => {
      const deadline = questionDeadlines[question.id];
      if (question.time_limit_seconds > 0 && deadline && Date.now() >= deadline && !expiredQuestions[question.id]) {
        expireQuestion(question);
      }
    });
  }, [clockTick, sessionToken, windowToken, paused, questions, questionDeadlines, expiredQuestions, expireQuestion]);

  useEffect(() => {
    if (!sessionToken || !windowToken) return;
    const onVisibility = () => {
      if (document.hidden) reportViolation("TAB_SWITCH", "Tab switch was detected.");
    };
    const onBlur = () => reportViolation("WINDOW_BLUR", "Window lost focus was detected.");
    const onContext = event => {
      event.preventDefault();
      reportViolation("RIGHT_CLICK", "Right-click is disabled during exams.");
    };
    const onClipboard = event => {
      const insideCode = event.target?.closest?.(".reactCodingWorkspace");
      if (insideCode) return;
      event.preventDefault();
      reportViolation(`${event.type.toUpperCase()}_ATTEMPT`, `${event.type} is disabled during exams.`);
    };
    const onKeydown = event => {
      const key = event.key.toLowerCase();
      const insideCode = event.target?.closest?.(".reactCodingWorkspace");
      const codeAllowed = insideCode && (event.ctrlKey || event.metaKey) && ["a", "c", "v", "x"].includes(key);
      const blocked = !codeAllowed && (
        event.key === "F12" ||
        (event.ctrlKey && ["a", "c", "v", "x", "s", "p", "u", "r", "w"].includes(key)) ||
        (event.ctrlKey && event.shiftKey && ["i", "j", "c"].includes(key))
      );
      if (blocked) {
        event.preventDefault();
        reportViolation("KEYBOARD_SHORTCUT_BLOCKED", "A blocked keyboard shortcut was pressed.");
      }
    };
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setFullscreenPrompt(true);
        reportViolation("FULLSCREEN_EXIT", "Fullscreen was exited.");
      }
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("copy", onClipboard);
    document.addEventListener("cut", onClipboard);
    document.addEventListener("paste", onClipboard);
    document.addEventListener("keydown", onKeydown);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("online", flushOfflineQueue);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("copy", onClipboard);
      document.removeEventListener("cut", onClipboard);
      document.removeEventListener("paste", onClipboard);
      document.removeEventListener("keydown", onKeydown);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("online", flushOfflineQueue);
    };
  }, [sessionToken, windowToken, reportViolation, flushOfflineQueue]);

  if (loading) {
    return <div className="loadingScreen">Loading exam...</div>;
  }

  if (error) {
    return (
      <section className="emptyState">
        <ShieldAlert size={36} />
        <h2>Exam cannot open</h2>
        <p>{error}</p>
        <a className="button primary" href="/student/dashboard">Back to dashboard</a>
      </section>
    );
  }

  return (
    <div className="reactExamShell">
      {fullscreenPrompt && (
        <div className="focusGate">
          <section>
            <Expand size={34} />
            <h2>Enter focused exam mode</h2>
            <p>Your timer, autosave, and security checks are active. Keep this window open and focused.</p>
            <button className="button primary" type="button" onClick={enterFullscreen}>
              <Expand size={18} /> Start Focus Mode
            </button>
          </section>
        </div>
      )}

      {paused && (
        <div className="focusGate">
          <section>
            <AlertTriangle size={34} />
            <h2>Timer paused</h2>
            <p>An admin has paused this attempt. Stay on this screen until it resumes.</p>
            <button className="button secondary" type="button" onClick={sendHeartbeat}>Check status</button>
          </section>
        </div>
      )}

      <header className="reactExamHeader">
        <div>
          <span className="eyebrow">Now writing</span>
          <h1>{examState?.exam?.exam_name}</h1>
          <p>{examState?.student_session?.student_name} | Roll {examState?.student_session?.roll_no} | Set {examState?.exam?.set_code}</p>
        </div>
        <div className={`reactTimer ${remainingSeconds <= 300 ? "danger" : remainingSeconds <= 600 ? "warning" : ""}`}>
          <span>Time Left</span>
          <strong>{formatExamTime(remainingSeconds)}</strong>
        </div>
        <div className="examHeaderActions">
          <div className="autosavePill"><Cloud size={16} /> {autosaveState}</div>
          <button className="button secondary" type="button" onClick={enterFullscreen}><Expand size={18} /></button>
          <button className="button danger" type="button" disabled={submitting} onClick={confirmSubmit}>
            <Send size={18} /> Submit
          </button>
        </div>
      </header>

      <div className="reactExamGrid">
        <aside className="reactQuestionPanel">
          <div className="examSideCard">
            <div className="rowBetween">
              <span>Answered</span>
              <strong>{answeredCount}/{questions.length}</strong>
            </div>
            <div className="progressLine"><span style={{ width: `${progressPercent}%` }} /></div>
            <p>{progressPercent}% complete</p>
          </div>

          <div className="examSideCard">
            <div className="rowBetween">
              <span>Focus warnings</span>
              <strong>{Math.min(violationCount, warningLimit)}/{warningLimit}</strong>
            </div>
            <div className="warningDots">
              {Array.from({ length: warningLimit }).map((_, index) => (
                <span key={index} className={index < violationCount ? "active" : ""} />
              ))}
            </div>
          </div>

          <div className="examSideCard">
            <span className="eyebrow">Questions</span>
            <div className="reactPalette">
              {questions.map((question, index) => (
                <button
                  key={question.id}
                  type="button"
                  className={normalizeStatus(statuses[question.id]).toLowerCase().replaceAll("_", "-")}
                  onClick={() => visitQuestion(index)}
                >
                  {question.question_number}
                </button>
              ))}
            </div>
            <div className="statusSummary">
              {QUESTION_STATES.map(state => (
                <div key={state}><span>{statusLabel(state)}</span><strong>{counts[state]}</strong></div>
              ))}
            </div>
          </div>
        </aside>

        {currentQuestion && (
          <main className="reactQuestionMain">
            <article className="reactQuestionCard">
              <div className="questionCardHead">
                <div>
                  <span className="questionNumber">Question {currentQuestion.question_number}</span>
                  <h2>{currentQuestion.question_text}</h2>
                </div>
                <div className="questionToolset">
                  <button
                    type="button"
                    className={`iconButton ${isFlagged(statuses[currentQuestion.id]) ? "active" : ""}`}
                    onClick={() => toggleFlag(currentQuestion)}
                    aria-label="Flag for review"
                  >
                    <Bookmark size={18} />
                  </button>
                  <span className="status">{currentQuestion.marks} mark{currentQuestion.marks === 1 ? "" : "s"}</span>
                  {currentQuestion.time_limit_seconds > 0 && (
                    <span className={`questionTimerPill ${expiredQuestions[currentQuestion.id] ? "expired" : currentQuestionRemaining <= 30 ? "danger" : ""}`}>
                      {expiredQuestions[currentQuestion.id] ? "Expired" : formatExamTime(currentQuestionRemaining ?? currentQuestion.time_limit_seconds)}
                    </span>
                  )}
                </div>
              </div>

              {currentQuestion.image_urls?.length > 0 && (
                <div className="questionImages">
                  {currentQuestion.image_urls.map(url => (
                    <a href={url} target="_blank" rel="noreferrer" key={url}>
                      <img src={url} alt={`Question ${currentQuestion.question_number}`} />
                    </a>
                  ))}
                </div>
              )}

              {currentQuestion.code_snippet && (
                <pre className="questionCodeSnippet"><code>{currentQuestion.code_snippet}</code></pre>
              )}

              <AnswerEditor
                question={currentQuestion}
                value={answers[currentQuestion.id] || ""}
                output={outputs[currentQuestion.id] || ""}
                stdinValue={stdinValues[currentQuestion.id] || ""}
                expired={Boolean(expiredQuestions[currentQuestion.id])}
                onChange={value => updateAnswer(currentQuestion, value)}
                onStdinChange={value => setStdinValues(current => ({ ...current, [currentQuestion.id]: value }))}
                onRun={() => runCode(currentQuestion)}
                running={runningQuestionId === currentQuestion.id}
              />
            </article>

            <footer className="questionNavFooter">
              <button className="button secondary" type="button" disabled={currentIndex === 0} onClick={() => visitQuestion(currentIndex - 1)}>
                <ChevronLeft size={18} /> Previous
              </button>
              <button className="button secondary" type="button" onClick={() => toggleFlag(currentQuestion)}>
                <Bookmark size={18} /> {isFlagged(statuses[currentQuestion.id]) ? "Unmark" : "Mark for review"}
              </button>
              <button className="button primary" type="button" disabled={currentIndex >= questions.length - 1} onClick={() => visitQuestion(currentIndex + 1)}>
                Next <ChevronRight size={18} />
              </button>
            </footer>
          </main>
        )}
      </div>
    </div>
  );
}

function AnswerEditor({ question, value, output, stdinValue, expired, onChange, onStdinChange, onRun, running }) {
  if (question.question_type === "mcq") {
    return (
      <div className="reactMcqList">
        {question.options.map(option => (
          <label key={option} className="reactMcqOption">
            <input
              type="radio"
              name={`q_${question.id}`}
              value={option}
              checked={value === option}
              disabled={expired}
              onChange={() => onChange(option)}
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
    );
  }

  if (question.question_type === "coding") {
    return (
      <div className="reactCodingWorkspace">
        <div className="codingToolbar">
          <span><TerminalSquare size={18} /> Python</span>
          <button className="button primary" type="button" onClick={onRun} disabled={running || expired}>
            <Play size={18} /> {running ? "Running..." : "Run Code"}
          </button>
        </div>
        <div className="reactCodeEditor">
          <Editor
            height="360px"
            language="python"
            theme="vs-dark"
            value={value}
            onChange={nextValue => onChange(nextValue || "")}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              lineNumbers: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              readOnly: expired
            }}
          />
        </div>
        <label className="stdinLabel" htmlFor={`stdin-${question.id}`}>stdin for input()</label>
        <textarea
          id={`stdin-${question.id}`}
          className="reactStdinInput"
          value={stdinValue}
          onChange={event => onStdinChange(event.target.value)}
          rows={3}
          placeholder="Each line is passed to Python stdin"
          disabled={expired}
        />
        <XtermOutput output={output || "Run output will appear here."} />
      </div>
    );
  }

  return (
    <textarea
      className="reactAnswerTextarea"
      value={value}
      onChange={event => onChange(event.target.value)}
      disabled={expired}
      rows={question.question_type === "long" ? 12 : 7}
      placeholder="Write your answer here"
    />
  );
}

function XtermOutput({ output }) {
  const hostRef = useRef(null);
  const terminalRef = useRef(null);

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const terminal = new Terminal({
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      fontFamily: '"JetBrains Mono", "Fira Code", Consolas, monospace',
      fontSize: 13,
      rows: 8,
      theme: {
        background: "#0b1220",
        foreground: "#dbeafe",
        cursor: "#dbeafe"
      }
    });
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    return () => {
      terminal.dispose();
      terminalRef.current = null;
    };
  }, []);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.clear();
    String(output || "").split(/\r?\n/).forEach(line => terminal.writeln(line));
  }, [output]);

  return <div className="reactTerminalHost" ref={hostRef} />;
}
