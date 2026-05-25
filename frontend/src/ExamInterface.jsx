/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import toast from "react-hot-toast";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import {
  AlertTriangle,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Expand,
  Grid3X3,
  Play,
  Send,
  ShieldAlert,
  TerminalSquare,
  X
} from "lucide-react";
import { Button, Card, Badge, ConfirmationDialog, Textarea, cn } from "./components/ui";
import { api } from "./services/api";
import { createRealtimeSocket } from "./services/realtime";

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

const STATUS_LEGEND = [
  { status: "NOT_VISITED", label: "Not visited" },
  { status: "VISITED_UNANSWERED", label: "Not answered" },
  { status: "ANSWERED", label: "Answered" },
  { status: "MARKED_REVIEW", label: "Marked" },
  { status: "ANSWERED_MARKED", label: "Answered + marked" }
];

function statusDotClass(status) {
  const normalized = normalizeStatus(status);
  if (normalized === "ANSWERED") return "bg-success";
  if (normalized === "MARKED_REVIEW") return "bg-brand-primary";
  if (normalized === "ANSWERED_MARKED") return "bg-info";
  if (normalized === "VISITED_UNANSWERED") return "bg-danger";
  return "bg-text-muted";
}

function isoDeadlineToMs(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function useMonacoTheme() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    const updateTheme = () => setIsDark(document.documentElement.classList.contains("dark"));
    const observer = new window.MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    updateTheme();
    return () => observer.disconnect();
  }, []);

  return isDark ? "vs-dark" : "light";
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
  const [navigatorCollapsed, setNavigatorCollapsed] = useState(false);
  const [mobileNavigatorOpen, setMobileNavigatorOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [autosaveState, setAutosaveState] = useState("Ready");
  const [violationCount, setViolationCount] = useState(0);
  const [warningOverlay, setWarningOverlay] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [paused, setPaused] = useState(false);
  const [runningQuestionId, setRunningQuestionId] = useState(null);
  const [fullscreenPrompt, setFullscreenPrompt] = useState(true);
  const saveTimers = useRef({});
  const stdinRefs = useRef({});
  const submittedRef = useRef(false);
  const lastViolationCountRef = useRef(0);

  const questions = examState?.questions || [];
  const currentQuestion = questions[currentIndex];
  const warningLimit = examState?.max_violations_allowed || 3;
  const monacoTheme = useMonacoTheme();

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

  useEffect(() => {
    function snapshotAnswers(event) {
      if (event.detail?.sessionCode && event.detail.sessionCode !== sessionCode) return;
      try {
        const key = `react_exam_buffer_${sessionCode}`;
        const queue = JSON.parse(window.localStorage.getItem(key) || "{}");
        questions.forEach(question => {
          queue[question.id] = {
            question_id: question.id,
            answer_text: answers[question.id] || "",
            visit_status: normalizeStatus(statuses[question.id])
          };
        });
        window.localStorage.setItem(key, JSON.stringify(queue));
      } catch {
        // best effort before the global session-ended overlay takes over
      }
    }

    window.addEventListener("exam-platform:session-ended", snapshotAnswers);
    return () => window.removeEventListener("exam-platform:session-ended", snapshotAnswers);
  }, [answers, questions, sessionCode, statuses]);

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
      lastViolationCountRef.current = data.student_session?.focus_violations || 0;
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
      lastViolationCountRef.current = nextCount;
      setWarningOverlay({
        count: Math.min(nextCount, warningLimit),
        type,
        detail
      });
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
  }, [sessionCode, sessionToken, windowToken, paused, warningLimit, requestHeaders, requestPayload, redirectFromPayload]);

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
      if (typeof data.focus_violations === "number") {
        if (data.focus_violations > lastViolationCountRef.current) {
          lastViolationCountRef.current = data.focus_violations;
          setWarningOverlay({
            count: Math.min(data.focus_violations, warningLimit),
            type: "FOCUS_WARNING",
            detail: "A focus violation was detected."
          });
        }
        setViolationCount(data.focus_violations);
      }
      setPaused(Boolean(data.paused));
      if (data.submitted && data.redirect) window.location.replace(data.redirect);
    } catch {
      setAutosaveState("Connection unstable");
    }
  }, [sessionCode, sessionToken, windowToken, violationCount, warningLimit, requestHeaders, requestPayload, redirectFromPayload]);

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
      window.location.replace(data.redirect || examState?.student_session?.submitted_url || "/react/student");
    } catch {
      window.location.replace(examState?.student_session?.submitted_url || "/react/student");
    }
  }, [sessionCode, sessionToken, windowToken, statuses, answers, saveAnswerNow, requestHeaders, requestPayload, examState]);

  const confirmSubmit = useCallback(() => {
    setShowSubmitConfirm(true);
  }, []);

  const focusStdinInput = useCallback(questionId => {
    window.setTimeout(() => {
      stdinRefs.current[questionId]?.focus?.();
    }, 50);
  }, []);

  const runCode = useCallback(async question => {
    if (expiredQuestions[question.id]) return;
    const code = answers[question.id] || "";
    const stdin = stdinValues[question.id] || "";
    const needsInput = /\binput\s*\(/.test(code);
    const nextStatus = computeStatus(code, isFlagged(statuses[question.id]), true);

    if (needsInput && !stdin.trim()) {
      setOutputs(current => ({
        ...current,
        [question.id]: "This code uses input(). Type the values in User Input, one per line, then click Run Code again."
      }));
      setAutosaveState("Input required");
      focusStdinInput(question.id);
      return;
    }

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
      if (needsInput && data.status !== "success" && /EOFError|input/i.test(`${data.message || ""}\n${data.stderr || ""}`)) {
        parts.push("\nYour program still needs more input. Add each value on a new line in User Input, then run again.");
        focusStdinInput(question.id);
      }
      setOutputs(current => ({ ...current, [question.id]: parts.join("\n") }));
      setAutosaveState("Code run saved");
    } catch (err) {
      const message = err.response?.data?.message || err.message || "Run failed";
      const stderr = err.response?.data?.stderr || "";
      const inputHint = needsInput && /EOFError|input/i.test(`${message}\n${stderr}`)
        ? "\n\nYour program is waiting for input. Add the values in User Input, one per line, then run again."
        : "";
      setOutputs(current => ({ ...current, [question.id]: `${message}${inputHint}` }));
      if (inputHint) focusStdinInput(question.id);
      setAutosaveState("Run failed");
    } finally {
      setRunningQuestionId(null);
    }
  }, [answers, statuses, stdinValues, expiredQuestions, sessionCode, requestHeaders, requestPayload, redirectFromPayload, saveAnswerNow, focusStdinInput]);

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
  const submitSummary = useMemo(() => ({
    answered: counts.ANSWERED + counts.ANSWERED_MARKED,
    notAnswered: counts.VISITED_UNANSWERED,
    notVisited: counts.NOT_VISITED,
    markedForReview: counts.MARKED_REVIEW,
    answeredAndMarked: counts.ANSWERED_MARKED,
    flagged: counts.MARKED_REVIEW + counts.ANSWERED_MARKED
  }), [counts]);
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
    if (!sessionToken || !examState?.student_session?.id) return undefined;

    const socket = createRealtimeSocket();
    const showConnectionToast = () => {
      toast.success("Realtime connected", { id: "exam-realtime", duration: 1400 });
      socket.emit("student:join", {
        session_code: sessionCode,
        session_token: sessionToken
      });
    };
    const showDisconnectToast = () => {
      toast("Realtime paused. Polling still protects the exam.", { id: "exam-realtime", duration: 3000 });
    };
    const handleRealtimeError = payload => {
      if (payload?.message) toast.error(payload.message, { id: "exam-realtime-error" });
    };
    const handleTerminated = payload => {
      submittedRef.current = true;
      toast.error(payload?.reason || "Your exam was ended by admin.", { duration: 5000 });
      window.setTimeout(() => {
        window.location.replace(payload?.redirect || examState?.student_session?.submitted_url || `/react/student/submitted/${sessionCode}`);
      }, 700);
    };
    const handleTimeReduced = payload => {
      if (typeof payload?.newRemainingSeconds === "number") {
        setRemainingSeconds(payload.newRemainingSeconds);
      }
      toast("Your remaining time has been adjusted.", { duration: 5000 });
    };
    const handlePaused = payload => {
      setPaused(true);
      toast(payload?.message || "Your exam timer is paused by admin.", { duration: 5000 });
    };
    const handleResumed = payload => {
      setPaused(false);
      if (typeof payload?.remainingSeconds === "number") {
        setRemainingSeconds(payload.remainingSeconds);
      }
      toast.success(payload?.message || "Your exam has resumed.", { duration: 5000 });
    };
    const handleSecondChance = payload => {
      lastViolationCountRef.current = 0;
      setViolationCount(0);
      setWarningOverlay(null);
      setPaused(false);
      toast.success(payload?.message || "Second chance granted.", { duration: 5000 });
    };
    const handleAdminMessage = payload => {
      toast(payload?.message || "Admin sent you a message.", { duration: 8000 });
    };
    const handleSubmitted = payload => {
      submittedRef.current = true;
      window.location.replace(payload?.redirect || examState?.student_session?.submitted_url || `/react/student/submitted/${sessionCode}`);
    };

    socket.on("connect", showConnectionToast);
    socket.on("disconnect", showDisconnectToast);
    socket.on("realtime:error", handleRealtimeError);
    socket.on("exam:terminated", handleTerminated);
    socket.on("exam:time_reduced", handleTimeReduced);
    socket.on("exam:paused", handlePaused);
    socket.on("exam:resumed", handleResumed);
    socket.on("exam:second_chance", handleSecondChance);
    socket.on("exam:admin_message", handleAdminMessage);
    socket.on("exam:submitted", handleSubmitted);
    socket.connect();

    return () => {
      socket.off("connect", showConnectionToast);
      socket.off("disconnect", showDisconnectToast);
      socket.off("realtime:error", handleRealtimeError);
      socket.off("exam:terminated", handleTerminated);
      socket.off("exam:time_reduced", handleTimeReduced);
      socket.off("exam:paused", handlePaused);
      socket.off("exam:resumed", handleResumed);
      socket.off("exam:second_chance", handleSecondChance);
      socket.off("exam:admin_message", handleAdminMessage);
      socket.off("exam:submitted", handleSubmitted);
      socket.disconnect();
    };
  }, [sessionCode, sessionToken, examState?.student_session?.id]);

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
        <Button as="a" variant="primary" size="sm" href="/react/student">Back to dashboard</Button>
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
            <Button variant="primary" size="sm" onClick={enterFullscreen}>
              <Expand size={18} /> Start Focus Mode
            </Button>
          </section>
        </div>
      )}

      {paused && (
        <div className="focusGate">
          <section>
            <AlertTriangle size={34} />
            <h2>Timer paused</h2>
            <p>An admin has paused this attempt. Stay on this screen until it resumes.</p>
            <Button variant="secondary" size="sm" onClick={sendHeartbeat}>Check status</Button>
          </section>
        </div>
      )}

      {warningOverlay && (
        <div className="fixed inset-0 z-[1000] grid place-items-center bg-slate-950/75 p-4 animate-page-fade" role="alertdialog" aria-modal="true" aria-labelledby="violation-warning-title">
          <section
            className={cn(
              "w-full max-w-md rounded-card border bg-background-surface p-6 text-center shadow-elevated animate-warning-bounce",
              warningOverlay.count >= warningLimit ? "border-danger" : "border-warning/40"
            )}
          >
            <div className={cn(
              "mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full",
              warningOverlay.count >= warningLimit ? "bg-danger/10 text-danger" : "bg-warning/10 text-warning"
            )}>
              <AlertTriangle size={30} />
            </div>
            <p className={cn("mb-2 text-sm font-bold uppercase", warningOverlay.count >= warningLimit ? "text-danger" : "text-warning")}>
              Warning {warningOverlay.count} of {warningLimit}
            </p>
            <h2 id="violation-warning-title" className="text-2xl font-bold text-text-primary">
              {warningOverlay.count >= warningLimit ? "Admin Has Been Alerted" : "Stay in the Exam Window"}
            </h2>
            <p className="mt-3 text-text-secondary">
              {warningOverlay.count >= warningLimit
                ? "Your warning limit has been reached. An admin is now deciding the outcome of this attempt."
                : warningOverlay.detail || "A focus violation was detected. Keep the exam fullscreen and focused."}
            </p>
            {warningOverlay.count >= warningLimit && (
              <div className="mt-4 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm font-semibold text-danger">
                Do not leave this screen. Admin review is active.
              </div>
            )}
            <Button
              variant={warningOverlay.count >= warningLimit ? "danger" : "primary"}
              className="mt-5 w-full"
              onClick={() => setWarningOverlay(null)}
            >
              Understood
            </Button>
          </section>
        </div>
      )}

      <ConfirmationDialog
        open={showSubmitConfirm}
        title="Submit Exam?"
        description={(
          <div className="grid gap-4">
            <p>Your saved answers will be sent before final submission. You cannot continue this attempt after submitting.</p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md border border-border bg-background-base p-3">
                <dt className="text-text-muted">Answered</dt>
                <dd className="font-bold text-text-primary">{submitSummary.answered}</dd>
              </div>
              <div className="rounded-md border border-border bg-background-base p-3">
                <dt className="text-text-muted">Not Answered</dt>
                <dd className="font-bold text-text-primary">{submitSummary.notAnswered}</dd>
              </div>
              <div className="rounded-md border border-border bg-background-base p-3">
                <dt className="text-text-muted">Not Visited</dt>
                <dd className="font-bold text-text-primary">{submitSummary.notVisited}</dd>
              </div>
              <div className="rounded-md border border-border bg-background-base p-3">
                <dt className="text-text-muted">Marked for Review</dt>
                <dd className="font-bold text-text-primary">{submitSummary.markedForReview}</dd>
              </div>
              <div className="col-span-2 rounded-md border border-border bg-background-base p-3">
                <dt className="text-text-muted">Answered and Marked</dt>
                <dd className="font-bold text-text-primary">{submitSummary.answeredAndMarked}</dd>
              </div>
            </dl>
            {(submitSummary.notAnswered > 0 || submitSummary.flagged > 0) && (
              <div className="rounded-md border border-warning/30 bg-warning/10 p-3 text-sm font-semibold text-warning">
                You have {submitSummary.notAnswered} unanswered questions and {submitSummary.flagged} flagged questions.
              </div>
            )}
          </div>
        )}
        confirmLabel="Submit Exam"
        variant="danger"
        loading={submitting}
        onConfirm={() => {
          setShowSubmitConfirm(false);
          submitExam("Manual submission");
        }}
        onClose={() => setShowSubmitConfirm(false)}
      />

      {lightboxImage && (
        <div
          className="fixed inset-0 z-[1001] grid place-items-center bg-slate-950/90 p-4 animate-page-fade"
          role="dialog"
          aria-modal="true"
          aria-label="Question image preview"
          onClick={() => setLightboxImage(null)}
        >
          <Button
            variant="ghost"
            className="absolute right-4 top-4 h-11 w-11 border-white/20 bg-white/10 px-0 text-white hover:bg-white/20"
            onClick={event => {
              event.stopPropagation();
              setLightboxImage(null);
            }}
            aria-label="Close image preview"
          >
            <X size={20} />
          </Button>
          <img
            src={lightboxImage}
            alt="Expanded question attachment"
            className="max-h-[88vh] max-w-[92vw] rounded-card border border-white/15 object-contain shadow-elevated animate-lightbox-image"
            onClick={event => event.stopPropagation()}
          />
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
          <Button variant="secondary" size="sm" onClick={enterFullscreen}><Expand size={18} /></Button>
          <Button variant="danger" size="sm" disabled={submitting} onClick={confirmSubmit}>
            <Send size={18} /> Submit
          </Button>
        </div>
      </header>

      <div className={cn("reactExamGrid", navigatorCollapsed && "navigatorCollapsed")}>
        <aside className={cn("reactQuestionPanel hidden md:grid", navigatorCollapsed && "collapsed")}>
          {navigatorCollapsed ? (
            <Card className="examSideCard collapsedNavigatorCard">
              <Button
                variant="ghost"
                size="sm"
                className="mb-2 h-8 min-h-8 w-8 px-0"
                onClick={() => setNavigatorCollapsed(false)}
                aria-label="Expand question navigator"
              >
                <ChevronRight size={16} />
              </Button>
              <div className="grid justify-items-center gap-2">
                {questions.map((question, index) => {
                  const status = normalizeStatus(statuses[question.id]);
                  return (
                    <button
                      key={question.id}
                      type="button"
                      title={`Question ${question.question_number}: ${statusLabel(status)}`}
                      aria-label={`Go to question ${question.question_number}`}
                      className={cn("h-3 w-3 rounded-full ring-2 ring-background-base transition hover:scale-125", statusDotClass(status))}
                      onClick={() => visitQuestion(index)}
                    />
                  );
                })}
              </div>
            </Card>
          ) : (
            <>
              <Card className="examSideCard">
                <div className="rowBetween">
                  <span>Answered</span>
                  <strong>{answeredCount}/{questions.length}</strong>
                </div>
                <div className="progressLine"><span style={{ width: `${progressPercent}%` }} /></div>
                <p>{progressPercent}% complete</p>
              </Card>

              <Card className="examSideCard">
                <div className="rowBetween">
                  <span>Focus warnings</span>
                  <strong>{Math.min(violationCount, warningLimit)}/{warningLimit}</strong>
                </div>
                <div className="warningDots">
                  {Array.from({ length: warningLimit }).map((_, index) => (
                    <span key={index} className={index < violationCount ? "active" : ""} />
                  ))}
                </div>
              </Card>

              <Card className="examSideCard">
                <div className="rowBetween">
                  <span className="eyebrow">Questions</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 min-h-8 w-8 px-0"
                    onClick={() => setNavigatorCollapsed(true)}
                    aria-label="Collapse question navigator"
                  >
                    <ChevronLeft size={16} />
                  </Button>
                </div>
                <div className="mb-3 grid gap-2 text-xs text-text-secondary">
                  {STATUS_LEGEND.map(item => (
                    <span key={item.status} className="flex items-center gap-2">
                      <span className={cn("h-2.5 w-2.5 rounded-sm", statusDotClass(item.status))} />
                      {item.label}
                    </span>
                  ))}
                </div>
                <div className="reactPalette">
                  {questions.map((question, index) => {
                    const status = normalizeStatus(statuses[question.id]);
                    return (
                      <Button
                        key={question.id}
                        variant={status === "ANSWERED" || status === "ANSWERED_MARKED" ? "success" : status === "MARKED_REVIEW" ? "warning" : "ghost"}
                        size="sm"
                        className={status.toLowerCase().replaceAll("_", "-")}
                        onClick={() => visitQuestion(index)}
                      >
                        {question.question_number}
                      </Button>
                    );
                  })}
                </div>
                <div className="statusSummary">
                  {QUESTION_STATES.map(state => (
                    <div key={state}><span>{statusLabel(state)}</span><strong>{counts[state]}</strong></div>
                  ))}
                </div>
              </Card>
            </>
          )}
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
                  <Button
                    variant={isFlagged(statuses[currentQuestion.id]) ? "danger" : "secondary"}
                    size="sm"
                    onClick={() => toggleFlag(currentQuestion)}
                    aria-label="Flag for review"
                  >
                    <Bookmark size={18} />
                  </Button>
                  <Badge variant="info" size="sm">{currentQuestion.marks} mark{currentQuestion.marks === 1 ? "" : "s"}</Badge>
                  {currentQuestion.time_limit_seconds > 0 && (
                    <Badge variant={expiredQuestions[currentQuestion.id] ? "danger" : currentQuestionRemaining <= 30 ? "warning" : "default"} size="sm">
                      {expiredQuestions[currentQuestion.id] ? "Expired" : formatExamTime(currentQuestionRemaining ?? currentQuestion.time_limit_seconds)}
                    </Badge>
                  )}
                </div>
              </div>

              {currentQuestion.image_urls?.length > 0 && (
                <div className="questionImages">
                  {currentQuestion.image_urls.map(url => (
                    <button type="button" className="rounded-md text-left" onClick={() => setLightboxImage(url)} key={url}>
                      <img src={url} alt={`Question ${currentQuestion.question_number}`} />
                    </button>
                  ))}
                </div>
              )}

              {currentQuestion.code_snippet && (
                <pre className="questionCodeSnippet"><code>{currentQuestion.code_snippet}</code></pre>
              )}

              <AnswerEditor
                question={currentQuestion}
                editorTheme={monacoTheme}
                value={answers[currentQuestion.id] || ""}
                output={outputs[currentQuestion.id] || ""}
                stdinValue={stdinValues[currentQuestion.id] || ""}
                expired={Boolean(expiredQuestions[currentQuestion.id])}
                onChange={value => updateAnswer(currentQuestion, value)}
                onStdinChange={value => setStdinValues(current => ({ ...current, [currentQuestion.id]: value }))}
                stdinRef={element => {
                  if (element) stdinRefs.current[currentQuestion.id] = element;
                }}
                onRun={() => runCode(currentQuestion)}
                running={runningQuestionId === currentQuestion.id}
              />
            </article>

            <footer className="questionNavFooter">
              <Button variant="secondary" size="sm" disabled={currentIndex === 0} onClick={() => visitQuestion(currentIndex - 1)}>
                <ChevronLeft size={18} /> Previous
              </Button>
              <Button variant="secondary" size="sm" onClick={() => toggleFlag(currentQuestion)}>
                <Bookmark size={18} /> {isFlagged(statuses[currentQuestion.id]) ? "Unmark" : "Mark for review"}
              </Button>
              <Button variant="primary" size="sm" disabled={currentIndex >= questions.length - 1} onClick={() => visitQuestion(currentIndex + 1)}>
                Next <ChevronRight size={18} />
              </Button>
            </footer>
          </main>
        )}
      </div>

      <Button
        variant="primary"
        className="fixed bottom-4 right-4 z-40 h-12 min-h-12 rounded-pill px-4 shadow-elevated md:hidden"
        onClick={() => setMobileNavigatorOpen(true)}
        aria-label="Open question navigator"
      >
        <Grid3X3 size={18} />
        {submitSummary.notAnswered + submitSummary.notVisited}
      </Button>

      {mobileNavigatorOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="presentation">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/60 animate-page-fade"
            aria-label="Close question navigator"
            onClick={() => setMobileNavigatorOpen(false)}
          />
          <section className="absolute inset-x-0 bottom-0 max-h-[82vh] overflow-y-auto rounded-t-card border border-border bg-background-surface p-4 shadow-elevated animate-drawer-bottom">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <span className="eyebrow">Questions</span>
                <h2 className="text-xl font-bold text-text-primary">Navigator</h2>
              </div>
              <Button variant="ghost" size="sm" className="h-11 w-11 px-0" onClick={() => setMobileNavigatorOpen(false)} aria-label="Close navigator">
                <X size={18} />
              </Button>
            </div>

            <div className="mb-4 rounded-card border border-border bg-background-base p-4">
              <div className="rowBetween">
                <span>Answered</span>
                <strong>{answeredCount}/{questions.length}</strong>
              </div>
              <div className="progressLine"><span style={{ width: `${progressPercent}%` }} /></div>
              <p>{progressPercent}% complete</p>
            </div>

            <div className="mb-4 grid grid-cols-2 gap-2 text-xs text-text-secondary">
              {STATUS_LEGEND.map(item => (
                <span key={item.status} className="flex items-center gap-2">
                  <span className={cn("h-2.5 w-2.5 rounded-sm", statusDotClass(item.status))} />
                  {item.label}
                </span>
              ))}
            </div>

            <div className="reactPalette">
              {questions.map((question, index) => {
                const status = normalizeStatus(statuses[question.id]);
                return (
                  <Button
                    key={question.id}
                    variant={status === "ANSWERED" || status === "ANSWERED_MARKED" ? "success" : status === "MARKED_REVIEW" ? "warning" : "ghost"}
                    size="sm"
                    className={status.toLowerCase().replaceAll("_", "-")}
                    onClick={() => {
                      visitQuestion(index);
                      setMobileNavigatorOpen(false);
                    }}
                  >
                    {question.question_number}
                  </Button>
                );
              })}
            </div>

            <div className="statusSummary mt-4">
              {QUESTION_STATES.map(state => (
                <div key={state}><span>{statusLabel(state)}</span><strong>{counts[state]}</strong></div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function AnswerEditor({ question, editorTheme, value, output, stdinValue, expired, onChange, onStdinChange, stdinRef, onRun, running }) {
  if (question.question_type === "mcq") {
    return (
      <div className="reactMcqList">
        {question.options.map(option => (
          <label
            key={option}
            className={`reactMcqOption ${value === option ? "selected" : ""} ${expired ? "disabled" : ""}`}
          >
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
          <Button variant="primary" size="sm" onClick={onRun} disabled={running || expired}>
            <Play size={18} /> {running ? "Running..." : "Run Code"}
          </Button>
        </div>
        <div className="reactCodeEditor">
          <Editor
            height="360px"
            language="python"
            theme={editorTheme}
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
        <label className="stdinLabel" htmlFor={`stdin-${question.id}`}>
          User Input <span>for input() prompts</span>
        </label>
        <Textarea
          ref={stdinRef}
          id={`stdin-${question.id}`}
          className="reactStdinInput"
          value={stdinValue}
          onChange={event => onStdinChange(event.target.value)}
          rows={3}
          placeholder={"Example:\n5\n10"}
          helperText="Type input values before running. Each line is sent to one input() call."
          disabled={expired}
        />
        <XtermOutput output={output || "Run output will appear here."} />
      </div>
    );
  }

  const maxCharacters = question.character_limit || question.max_characters || question.max_length || null;
  const wordCount = String(value || "").trim() ? String(value || "").trim().split(/\s+/).length : 0;
  const isLongAnswer = question.question_type === "long" || question.question_type === "long_answer";

  return (
    <div className="grid gap-2">
      <Textarea
        className="reactAnswerTextarea"
        value={value}
        onChange={event => onChange(event.target.value)}
        disabled={expired}
        rows={isLongAnswer ? 12 : 7}
        placeholder="Write your answer here"
        maxLength={maxCharacters || undefined}
      />
      <div className="text-right text-xs font-semibold text-text-muted">
        {isLongAnswer
          ? `${wordCount} words`
          : maxCharacters
            ? `${String(value || "").length} / ${maxCharacters}`
            : `${String(value || "").length} characters`}
      </div>
    </div>
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
