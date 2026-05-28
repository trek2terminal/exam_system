import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Editor from "@monaco-editor/react";
import "./monacoSetup.js";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";
import {
  AlertTriangle,
  Bell,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Eraser,
  Grid3X3,
  LoaderCircle,
  Maximize2,
  Pause,
  Play,
  Save,
  ShieldX,
  X
} from "lucide-react";
import toast from "react-hot-toast";
import { PlatformLogo, Tooltip, cn } from "./components/ui";
import { api } from "./services/api";
import { createRealtimeSocket } from "./services/realtime";
import { usePlatformSettings } from "./hooks/usePlatformSettings";

const STATUS = {
  NOT_VISITED: "NOT_VISITED",
  VISITED_UNANSWERED: "VISITED_UNANSWERED",
  ANSWERED: "ANSWERED",
  MARKED_REVIEW: "MARKED_REVIEW",
  ANSWERED_MARKED: "ANSWERED_MARKED"
};

const STATUS_ORDER = [
  STATUS.NOT_VISITED,
  STATUS.VISITED_UNANSWERED,
  STATUS.ANSWERED,
  STATUS.MARKED_REVIEW,
  STATUS.ANSWERED_MARKED
];

const STATUS_LABELS = {
  NOT_VISITED: "Unseen",
  VISITED_UNANSWERED: "Skipped",
  ANSWERED: "Done",
  MARKED_REVIEW: "Review",
  ANSWERED_MARKED: "Done+Review"
};

const LOCKED_STATUSES = new Set(["SUBMITTED", "AUTO_SUBMITTED", "TERMINATED", "EVALUATED"]);
const WARNING_TYPES = new Set(["FULLSCREEN_EXIT", "TAB_SWITCH", "WINDOW_BLUR", "KEYBOARD_SHORTCUT", "DEVTOOLS_OPEN"]);
const FONT_SIZES = { small: 14, medium: 16, large: 18 };

function normalizeStatus(value) {
  return STATUS_ORDER.includes(value) ? value : STATUS.NOT_VISITED;
}

function normalizeQuestionType(value) {
  const clean = String(value || "short").toLowerCase();
  if (clean === "coding") return "code";
  if (clean === "long_answer" || clean === "essay") return "long";
  if (["mcq", "short", "long", "code"].includes(clean)) return clean;
  return "short";
}

function formatTime(seconds) {
  const safeSeconds = Math.max(Math.floor(Number(seconds) || 0), 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(Math.floor(Number(seconds) || 0), 0);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  if (minutes <= 0) return `${remainder}s`;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function questionTypeLabel(type) {
  if (type === "mcq") return "MCQ";
  if (type === "long") return "Long Answer";
  if (type === "code") return "Python Code";
  return "Short Answer";
}

function getInitials(name) {
  const parts = String(name || "Student").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(part => part[0]?.toUpperCase()).join("") || "S";
}

function hasAnswer(question, answer) {
  if (!question || !answer) return false;
  if (question.type === "mcq") return Boolean(String(answer.selected_option || "").trim());
  if (question.type === "code") return Boolean(String(answer.code_text || "").trim());
  return Boolean(String(answer.answer_text || "").trim());
}

function isMarked(status) {
  return status === STATUS.MARKED_REVIEW || status === STATUS.ANSWERED_MARKED;
}

function statusFromAnswer(question, answer, marked = false, visited = true) {
  const answered = hasAnswer(question, answer);
  if (answered && marked) return STATUS.ANSWERED_MARKED;
  if (answered) return STATUS.ANSWERED;
  if (marked) return STATUS.MARKED_REVIEW;
  return visited ? STATUS.VISITED_UNANSWERED : STATUS.NOT_VISITED;
}

function optionLabel(index) {
  return String.fromCharCode(65 + index);
}

function safeJsonRead(key, fallback) {
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function safeJsonWrite(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Local offline persistence is best effort.
  }
}

function renderInlineMarkdown(text) {
  return String(text || "").split(/(\*\*[^*]+\*\*|`[^`]+`|\n)/g).map((part, index) => {
    if (part === "\n") return <br key={index} />;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(part)) return <code key={index}>{part.slice(1, -1)}</code>;
    return <span key={index}>{part}</span>;
  });
}

function normalizeQuestion(rawQuestion, index) {
  const type = normalizeQuestionType(rawQuestion.type || rawQuestion.question_type);
  const rawOptions = Array.isArray(rawQuestion.options) ? rawQuestion.options : [];
  const options = rawOptions.map((option, optionIndex) => {
    if (option && typeof option === "object") {
      const text = String(option.text || option.label || option.value || "").trim();
      return { id: String(option.id || option.value || text || optionIndex + 1), text };
    }
    const text = String(option || "").trim();
    return { id: text, text };
  }).filter(option => option.text);

  return {
    ...rawQuestion,
    id: rawQuestion.id,
    order_index: rawQuestion.order_index || rawQuestion.question_number || index + 1,
    type,
    options,
    marks: rawQuestion.marks ?? rawQuestion.max_marks ?? 0,
    max_marks: rawQuestion.max_marks ?? rawQuestion.marks ?? 0,
    image_urls: rawQuestion.image_urls || [],
    code_snippet: rawQuestion.code_snippet || "",
    starter_code: rawQuestion.starter_code || "",
    execution_time_limit_seconds: rawQuestion.execution_time_limit_seconds || 10
  };
}

function emptyAnswer() {
  return {
    answer_text: "",
    selected_option: null,
    code_text: "",
    code_output: "",
    navigator_status: STATUS.NOT_VISITED,
    time_spent_seconds: 0,
    visit_count: 0
  };
}

function normalizeSavedAnswer(question, saved) {
  const answer = { ...emptyAnswer(), ...(saved || {}) };
  answer.navigator_status = normalizeStatus(answer.navigator_status || answer.visit_status);
  if (question.type === "code" && !answer.code_text && saved?.answer_text) {
    answer.code_text = saved.answer_text;
  }
  if (question.type === "mcq" && !answer.selected_option && saved?.answer_text) {
    answer.selected_option = saved.answer_text;
  }
  if (question.type === "code" && !answer.code_text && question.starter_code) {
    answer.code_text = question.starter_code;
  }
  answer.time_spent_seconds = Number(saved?.time_spent_seconds || saved?.total_time_spent_seconds || 0);
  answer.visit_count = Number(saved?.visit_count || 0);
  return answer;
}

function isEditableTarget(target) {
  if (!(target instanceof window.Element)) return false;
  if (target.closest(".monaco-editor")) return true;
  if (target.closest("[data-stdin-input='true']")) return true;
  const tagName = target.tagName?.toLowerCase();
  return tagName === "textarea" || tagName === "input" || target.isContentEditable;
}

function isTextAnswerTarget(target) {
  return target instanceof window.Element && Boolean(target.closest("[data-answer-textarea='true']"));
}

function useLatestRef(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}

export default function ExamInterface() {
  const { sessionCode } = useParams();
  const navigate = useNavigate();
  const { settings: platformSettings } = usePlatformSettings();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [examState, setExamState] = useState(null);
  const [sessionToken, setSessionToken] = useState("");
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [stdinValues, setStdinValues] = useState({});
  const [runOutputs, setRunOutputs] = useState({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [maxWarnings, setMaxWarnings] = useState(3);
  const [paused, setPaused] = useState(false);
  const [online, setOnline] = useState(() => window.navigator.onLine);
  const [saveState, setSaveState] = useState({ type: "saved", text: "Saved" });
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitErrorMessage, setSubmitErrorMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [timeUpSubmitting, setTimeUpSubmitting] = useState(false);
  const [fullscreenBlocked, setFullscreenBlocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement));
  const [warningOverlay, setWarningOverlay] = useState(null);
  const [adminMessage, setAdminMessage] = useState(null);
  const [pausedToastShown, setPausedToastShown] = useState(false);
  const [terminateOverlay, setTerminateOverlay] = useState(false);
  const [secondChanceBanner, setSecondChanceBanner] = useState(false);
  const [offlineBanner, setOfflineBanner] = useState("");
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null);
  const [fontSizePreference, setFontSizePreference] = useState(() => {
    try {
      return window.localStorage.getItem("exam_question_font_size") || "medium";
    } catch {
      return "medium";
    }
  });
  const [transitioning, setTransitioning] = useState(false);
  const [fiveMinuteWarning, setFiveMinuteWarning] = useState(false);
  const [fiveMinuteDismissProgress, setFiveMinuteDismissProgress] = useState(100);
  const [oneMinuteToast, setOneMinuteToast] = useState(false);
  const [runningQuestionId, setRunningQuestionId] = useState(null);
  const [questionTimeSpent, setQuestionTimeSpent] = useState({});

  const saveTimersRef = useRef({});
  const forceSaveIntervalRef = useRef(null);
  const violationThrottleRef = useRef({});
  const autoSubmitStartedRef = useRef(false);
  const terminalResizeRef = useRef(null);
  const activeQuestionIdRef = useRef(null);
  const activeQuestionStartedAtRef = useRef(Date.now());
  const mountedRef = useRef(true);
  const hasHydratedRef = useRef(false);
  const sessionTokenRef = useLatestRef(sessionToken);
  const questionsRef = useLatestRef(questions);
  const answersRef = useLatestRef(answers);
  const questionTimeSpentRef = useLatestRef(questionTimeSpent);
  const currentIndexRef = useLatestRef(currentIndex);
  const onlineRef = useLatestRef(online);
  const showSubmitConfirmRef = useLatestRef(showSubmitConfirm);
  const submittingRef = useLatestRef(submitting);

  const currentQuestion = questions[currentIndex] || null;
  const currentAnswer = currentQuestion ? answers[currentQuestion.id] || emptyAnswer() : emptyAnswer();
  const exam = examState?.exam || {};
  const student = examState?.student || {};
  const questionFontSize = FONT_SIZES[fontSizePreference] || FONT_SIZES.medium;
  const canWork = !paused && !terminateOverlay && !submitting && remainingSeconds > 0;

  const bufferKey = `exam_offline_buffer_${sessionCode}`;
  const fiveMinuteKey = `exam_5min_warning_${sessionCode}`;

  const counts = useMemo(() => {
    const nextCounts = Object.fromEntries(STATUS_ORDER.map(status => [status, 0]));
    questions.forEach(question => {
      const answer = answers[question.id] || emptyAnswer();
      const status = normalizeStatus(answer.navigator_status);
      nextCounts[status] = (nextCounts[status] || 0) + 1;
    });
    return nextCounts;
  }, [answers, questions]);

  const answeredCount = (counts[STATUS.ANSWERED] || 0) + (counts[STATUS.ANSWERED_MARKED] || 0);
  const reviewCount = (counts[STATUS.MARKED_REVIEW] || 0) + (counts[STATUS.ANSWERED_MARKED] || 0);
  const unansweredCount = (counts[STATUS.VISITED_UNANSWERED] || 0) + (counts[STATUS.NOT_VISITED] || 0);
  const progressPercent = questions.length ? Math.round((answeredCount / questions.length) * 100) : 0;

  const requestFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      setFullscreenBlocked(false);
      setIsFullscreen(true);
    } catch {
      setFullscreenBlocked(true);
      setIsFullscreen(false);
    }
  }, []);

  const syncRemainingSeconds = useCallback(value => {
    if (typeof value !== "number") return;
    setRemainingSeconds(current => (Math.abs(current - value) > 3 ? value : current));
  }, []);

  const showAdminMessage = useCallback(message => {
    const cleanMessage = String(message || "").trim();
    if (!cleanMessage) return;
    setAdminMessage(cleanMessage);
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        const context = new AudioContextClass();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = 740;
        gain.gain.value = 0.04;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        window.setTimeout(() => {
          oscillator.stop();
          context.close();
        }, 120);
      }
    } catch {
      // Audio is helpful, not required.
    }
    window.setTimeout(() => setAdminMessage(null), 15000);
  }, []);

  const getQuestionTimeSpentSeconds = useCallback(questionId => {
    const baseSeconds = Number(questionTimeSpentRef.current[questionId] || 0);
    if (activeQuestionIdRef.current !== questionId) return baseSeconds;
    const activeSeconds = Math.max(Math.floor((Date.now() - activeQuestionStartedAtRef.current) / 1000), 0);
    return baseSeconds + activeSeconds;
  }, [questionTimeSpentRef]);

  const commitActiveQuestionTime = useCallback(() => {
    const activeQuestionId = activeQuestionIdRef.current;
    if (!activeQuestionId) return null;
    const elapsedSeconds = Math.max(Math.floor((Date.now() - activeQuestionStartedAtRef.current) / 1000), 0);
    if (elapsedSeconds <= 0) return { questionId: activeQuestionId, seconds: Number(questionTimeSpentRef.current[activeQuestionId] || 0) };
    const nextSeconds = Number(questionTimeSpentRef.current[activeQuestionId] || 0) + elapsedSeconds;
    const nextMap = { ...questionTimeSpentRef.current, [activeQuestionId]: nextSeconds };
    questionTimeSpentRef.current = nextMap;
    setQuestionTimeSpent(nextMap);
    activeQuestionStartedAtRef.current = Date.now();
    return { questionId: activeQuestionId, seconds: nextSeconds };
  }, [questionTimeSpentRef]);

  const answerPayload = useCallback((question, answer) => ({
    session_token: sessionTokenRef.current,
    question_id: question.id,
    answer_text: question.type === "short" || question.type === "long" ? answer.answer_text || "" : "",
    selected_option: question.type === "mcq" ? answer.selected_option || "" : null,
    code_text: question.type === "code" ? answer.code_text || "" : "",
    navigator_status: normalizeStatus(answer.navigator_status),
    time_spent_seconds: getQuestionTimeSpentSeconds(question.id)
  }), [getQuestionTimeSpentSeconds, sessionTokenRef]);

  const queueOfflineSave = useCallback((question, answer) => {
    const queue = safeJsonRead(bufferKey, []);
    const nextEntry = {
      ...answerPayload(question, answer),
      timestamp: new Date().toISOString()
    };
    const nextQueue = queue.filter(item => Number(item.question_id) !== Number(question.id));
    nextQueue.push(nextEntry);
    safeJsonWrite(bufferKey, nextQueue);
    setSaveState({ type: "offline", text: "Offline, buffering..." });
  }, [answerPayload, bufferKey]);

  const saveAnswerNow = useCallback(async (question, answer, options = {}) => {
    if (!question || !sessionTokenRef.current) return false;
    if (!onlineRef.current) {
      queueOfflineSave(question, answer);
      return false;
    }

    if (saveTimersRef.current[question.id]) {
      window.clearTimeout(saveTimersRef.current[question.id]);
      delete saveTimersRef.current[question.id];
    }

    if (!options.silent) setSaveState({ type: "saving", text: "Saving..." });
    try {
      const { data } = await api.post(`/student/session/${sessionCode}/autosave`, answerPayload(question, answer));
      if (typeof data.remaining_seconds === "number") syncRemainingSeconds(data.remaining_seconds);
      if (typeof data.warning_count === "number") setWarningCount(data.warning_count);
      setPaused(Boolean(data.is_paused));
      if (data.admin_message) showAdminMessage(data.admin_message);
      setSaveState({ type: "saved", text: "Saved" });
      return true;
    } catch (saveError) {
      if (!window.navigator.onLine || !saveError.response) {
        queueOfflineSave(question, answer);
      } else {
        setSaveState({ type: "error", text: "Save failed, retrying..." });
      }
      return false;
    }
  }, [answerPayload, onlineRef, queueOfflineSave, sessionCode, sessionTokenRef, showAdminMessage, syncRemainingSeconds]);

  const scheduleAutosave = useCallback((question, answer) => {
    if (!question) return;
    if (saveTimersRef.current[question.id]) {
      window.clearTimeout(saveTimersRef.current[question.id]);
    }
    saveTimersRef.current[question.id] = window.setTimeout(() => {
      saveAnswerNow(question, answer);
    }, 2000);
  }, [saveAnswerNow]);

  const updateAnswer = useCallback((question, patch) => {
    if (!question || !canWork) return;
    const previousAnswer = answersRef.current[question.id] || emptyAnswer();
    const merged = { ...previousAnswer, ...patch };
    const marked = isMarked(previousAnswer.navigator_status);
    merged.navigator_status = patch.navigator_status || statusFromAnswer(question, merged, marked, true);
    setAnswers(current => ({ ...current, [question.id]: merged }));
    scheduleAutosave(question, merged);
  }, [answersRef, canWork, scheduleAutosave]);

  const updateNavigatorStatus = useCallback(async (question, nextStatus) => {
    if (!question || !sessionTokenRef.current) return;
    const currentAnswerForQuestion = answersRef.current[question.id] || emptyAnswer();
    const nextAnswer = { ...currentAnswerForQuestion, navigator_status: normalizeStatus(nextStatus) };
    setAnswers(current => ({ ...current, [question.id]: nextAnswer }));
    if (!onlineRef.current) {
      queueOfflineSave(question, nextAnswer);
      return;
    }
    try {
      await api.post(`/student/session/${sessionCode}/navigator-update`, {
        session_token: sessionTokenRef.current,
        question_id: question.id,
        navigator_status: nextAnswer.navigator_status
      });
    } catch {
      setSaveState({ type: "error", text: "Save failed, retrying..." });
    }
  }, [answersRef, onlineRef, queueOfflineSave, sessionCode, sessionTokenRef]);

  const visitQuestion = useCallback(index => {
    const target = questionsRef.current[index];
    if (!target || index === currentIndexRef.current) return;
    const activeTiming = commitActiveQuestionTime();
    if (activeTiming?.questionId) {
      const previousQuestion = questionsRef.current.find(question => Number(question.id) === Number(activeTiming.questionId));
      if (previousQuestion) {
        saveAnswerNow(previousQuestion, answersRef.current[previousQuestion.id] || emptyAnswer(), { silent: true });
      }
    }
    setTransitioning(true);
    window.setTimeout(() => {
      setCurrentIndex(index);
      activeQuestionIdRef.current = target.id;
      activeQuestionStartedAtRef.current = Date.now();
      const answer = answersRef.current[target.id] || emptyAnswer();
      if (normalizeStatus(answer.navigator_status) === STATUS.NOT_VISITED) {
        updateNavigatorStatus(target, STATUS.VISITED_UNANSWERED);
      }
      window.setTimeout(() => setTransitioning(false), 150);
    }, 100);
  }, [answersRef, commitActiveQuestionTime, currentIndexRef, questionsRef, saveAnswerNow, updateNavigatorStatus]);

  const openSubmitConfirm = useCallback(() => {
    setSubmitErrorMessage("");
    setShowSubmitConfirm(true);
  }, []);

  const toggleFlag = useCallback(() => {
    if (!currentQuestion) return;
    const previousAnswer = answersRef.current[currentQuestion.id] || emptyAnswer();
    const marked = isMarked(previousAnswer.navigator_status);
    const answered = hasAnswer(currentQuestion, previousAnswer);
    const nextStatus = marked
      ? (answered ? STATUS.ANSWERED : STATUS.VISITED_UNANSWERED)
      : (answered ? STATUS.ANSWERED_MARKED : STATUS.MARKED_REVIEW);
    updateAnswer(currentQuestion, { navigator_status: nextStatus });
  }, [answersRef, currentQuestion, updateAnswer]);

  const goToNextOrSubmit = useCallback(() => {
    if (currentIndexRef.current >= questionsRef.current.length - 1) {
      openSubmitConfirm();
      return;
    }
    visitQuestion(currentIndexRef.current + 1);
  }, [currentIndexRef, openSubmitConfirm, questionsRef, visitQuestion]);

  const clearCurrentAnswer = useCallback(() => {
    if (!currentQuestion || !canWork) return;
    const previousAnswer = answersRef.current[currentQuestion.id] || emptyAnswer();
    const marked = isMarked(previousAnswer.navigator_status);
    const nextAnswer = {
      ...emptyAnswer(),
      navigator_status: marked ? STATUS.MARKED_REVIEW : STATUS.VISITED_UNANSWERED
    };
    setAnswers(current => ({ ...current, [currentQuestion.id]: nextAnswer }));
    setRunOutputs(current => {
      const nextOutputs = { ...current };
      delete nextOutputs[currentQuestion.id];
      return nextOutputs;
    });
    scheduleAutosave(currentQuestion, nextAnswer);
  }, [answersRef, canWork, currentQuestion, scheduleAutosave]);

  const saveAndContinue = useCallback(() => {
    if (!currentQuestion || !canWork) {
      goToNextOrSubmit();
      return;
    }
    const previousAnswer = answersRef.current[currentQuestion.id] || emptyAnswer();
    const nextAnswer = {
      ...previousAnswer,
      navigator_status: hasAnswer(currentQuestion, previousAnswer) ? STATUS.ANSWERED : STATUS.VISITED_UNANSWERED
    };
    setAnswers(current => ({ ...current, [currentQuestion.id]: nextAnswer }));
    saveAnswerNow(currentQuestion, nextAnswer);
    goToNextOrSubmit();
  }, [answersRef, canWork, currentQuestion, goToNextOrSubmit, saveAnswerNow]);

  const markForReviewAndContinue = useCallback(() => {
    if (!currentQuestion || !canWork) {
      goToNextOrSubmit();
      return;
    }
    const previousAnswer = answersRef.current[currentQuestion.id] || emptyAnswer();
    const nextAnswer = {
      ...previousAnswer,
      navigator_status: hasAnswer(currentQuestion, previousAnswer) ? STATUS.ANSWERED_MARKED : STATUS.MARKED_REVIEW
    };
    setAnswers(current => ({ ...current, [currentQuestion.id]: nextAnswer }));
    saveAnswerNow(currentQuestion, nextAnswer);
    goToNextOrSubmit();
  }, [answersRef, canWork, currentQuestion, goToNextOrSubmit, saveAnswerNow]);

  const flushOfflineBuffer = useCallback(async () => {
    const queue = safeJsonRead(bufferKey, []);
    if (!queue.length || !sessionTokenRef.current) return;
    setOfflineBanner("Connection restored. Syncing...");
    setSaveState({ type: "saving", text: "Syncing..." });
    for (const entry of queue) {
      try {
        await api.post(`/student/session/${sessionCode}/autosave`, {
          ...entry,
          session_token: sessionTokenRef.current
        });
      } catch {
        setOfflineBanner("Connection restored, but some answers still need syncing.");
        setSaveState({ type: "error", text: "Save failed, retrying..." });
        return;
      }
    }
    safeJsonWrite(bufferKey, []);
    setSaveState({ type: "saved", text: "Saved" });
    setOfflineBanner("All answers synced");
    toast.success("All answers synced");
    window.setTimeout(() => setOfflineBanner(""), 1800);
  }, [bufferKey, sessionCode, sessionTokenRef]);

  const submitExam = useCallback(async ({ auto = false, retry = true } = {}) => {
    if (!sessionTokenRef.current) {
      const message = "Exam session is still loading. Please wait a moment and try again.";
      setSubmitErrorMessage(message);
      toast.error(message);
      return;
    }
    if (submittingRef.current) return;
    setSubmitErrorMessage("");
    setSubmitting(true);
    if (auto) setTimeUpSubmitting(true);
    try {
      const question = questionsRef.current[currentIndexRef.current];
      const finalAnswer = question ? answerPayload(question, answersRef.current[question.id] || emptyAnswer()) : null;
      if (question) {
        await saveAnswerNow(question, answersRef.current[question.id] || emptyAnswer(), { silent: true });
      }
      const { data } = await api.post(`/student/session/${sessionCode}/submit`, {
        session_token: sessionTokenRef.current,
        reason: auto ? "Time expired" : "Manual submission",
        final_answer: finalAnswer
      });
      window.location.replace(data.redirect || `/react/student/results/${examState?.exam?.id || ""}`);
    } catch (submitError) {
      const message = submitError.response?.data?.message
        || submitError.response?.data?.error
        || submitError.message
        || "Could not submit the exam. Please try again.";
      if (auto && retry) {
        window.setTimeout(() => {
          setSubmitting(false);
          submitExam({ auto: true, retry: false });
        }, 2000);
        return;
      }
      if (auto) {
        setTimeUpSubmitting(false);
        setError("Your answers have been saved. Please contact the exam administrator.");
      } else {
        setSubmitErrorMessage(message);
        toast.error(message);
      }
    } finally {
      if (mountedRef.current && !auto) setSubmitting(false);
    }
  }, [answerPayload, answersRef, currentIndexRef, examState?.exam?.id, questionsRef, saveAnswerNow, sessionCode, sessionTokenRef, submittingRef]);

  const reportViolation = useCallback(async (violationType, options = {}) => {
    if (!sessionTokenRef.current || submittingRef.current) return;
    const now = Date.now();
    const throttleKey = violationType;
    if (now - (violationThrottleRef.current[throttleKey] || 0) < (options.throttleMs || 2500)) return;
    violationThrottleRef.current[throttleKey] = now;

    const showWarning = WARNING_TYPES.has(violationType) && !options.silent;
    try {
      const { data } = await api.post(`/student/session/${sessionCode}/violation`, {
        session_token: sessionTokenRef.current,
        violation_type: violationType,
        silent: Boolean(options.silent),
        detail: options.detail || ""
      });
      const nextCount = typeof data.warning_count === "number" ? data.warning_count : warningCount + (data.should_warn ? 1 : 0);
      setWarningCount(nextCount);
      if (showWarning && data.should_warn !== false) {
        setWarningOverlay({
          count: Math.min(nextCount, data.max_warnings || maxWarnings),
          max: data.max_warnings || maxWarnings,
          type: violationType
        });
      }
    } catch {
      if (showWarning) {
        const nextCount = warningCount + 1;
        setWarningCount(nextCount);
        setWarningOverlay({ count: Math.min(nextCount, maxWarnings), max: maxWarnings, type: violationType });
      }
    }
  }, [maxWarnings, sessionCode, sessionTokenRef, submittingRef, warningCount]);

  const handleHeartbeatPayload = useCallback(data => {
    if (!data) return;
    if (typeof data.remaining_seconds === "number") syncRemainingSeconds(data.remaining_seconds);
    if (typeof data.warning_count === "number") setWarningCount(data.warning_count);
    if (typeof data.focus_violations === "number") setWarningCount(data.focus_violations);
    if (typeof data.max_warnings === "number") setMaxWarnings(data.max_warnings);
    if (data.admin_message) showAdminMessage(data.admin_message);
    if (data.terminated) {
      setTerminateOverlay(true);
      return;
    }
    if (data.second_chance) {
      setWarningCount(0);
      setWarningOverlay(null);
      setSecondChanceBanner(true);
      window.setTimeout(() => setSecondChanceBanner(false), 4000);
    }
    if (data.time_reduced) toast("Exam time was adjusted by the administrator.");
    setPaused(Boolean(data.is_paused ?? data.paused));
  }, [showAdminMessage, syncRemainingSeconds]);

  const sendHeartbeat = useCallback(async () => {
    if (!sessionTokenRef.current || !onlineRef.current || submittingRef.current) return;
    const currentQuestionForHeartbeat = questionsRef.current[currentIndexRef.current];
    try {
      const { data } = await api.post(`/student/session/${sessionCode}/heartbeat`, {
        session_token: sessionTokenRef.current,
        current_question_index: currentIndexRef.current,
        current_question_id: currentQuestionForHeartbeat?.id,
        time_spent_seconds: currentQuestionForHeartbeat ? getQuestionTimeSpentSeconds(currentQuestionForHeartbeat.id) : undefined
      });
      if (data.terminated) {
        handleHeartbeatPayload(data);
        return;
      }
      if (data.redirect && data.submitted) {
        window.location.replace(data.redirect);
        return;
      }
      handleHeartbeatPayload(data);
    } catch {
      if (!window.navigator.onLine) setOnline(false);
    }
  }, [currentIndexRef, getQuestionTimeSpentSeconds, handleHeartbeatPayload, onlineRef, questionsRef, sessionCode, sessionTokenRef, submittingRef]);

  const runCode = useCallback(async question => {
    if (!question || question.type !== "code" || !canWork) return;
    const answer = answersRef.current[question.id] || emptyAnswer();
    setRunningQuestionId(question.id);
    setRunOutputs(current => ({
      ...current,
      [question.id]: { output: "", error: "", timed_out: false, execution_time_seconds: null, status: "running" }
    }));
    try {
      const { data } = await api.post(`/student/session/${sessionCode}/code-run`, {
        session_token: sessionTokenRef.current,
        question_id: question.id,
        code: answer.code_text || "",
        stdin: stdinValues[question.id] || "",
        navigator_status: statusFromAnswer(question, answer, isMarked(answer.navigator_status), true)
      });
      const nextOutput = {
        output: data.output || "",
        error: data.error || "",
        timed_out: Boolean(data.timed_out),
        execution_time_seconds: data.execution_time_seconds,
        status: data.status || "success"
      };
      setRunOutputs(current => ({ ...current, [question.id]: nextOutput }));
      setAnswers(current => ({
        ...current,
        [question.id]: {
          ...(current[question.id] || emptyAnswer()),
          code_output: [nextOutput.output, nextOutput.error].filter(Boolean).join("\n"),
          navigator_status: STATUS.ANSWERED
        }
      }));
    } catch (runError) {
      setRunOutputs(current => ({
        ...current,
        [question.id]: {
          output: "",
          error: runError.message || "Code execution failed.",
          timed_out: false,
          execution_time_seconds: null,
          status: "error"
        }
      }));
    } finally {
      setRunningQuestionId(null);
    }
  }, [answersRef, canWork, sessionCode, sessionTokenRef, stdinValues]);

  useEffect(() => {
    mountedRef.current = true;
    const activeSaveTimers = saveTimersRef.current;
    return () => {
      mountedRef.current = false;
      Object.values(activeSaveTimers).forEach(timerId => window.clearTimeout(timerId));
      if (forceSaveIntervalRef.current) window.clearInterval(forceSaveIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    async function loadExamState() {
      setLoading(true);
      setError("");
      try {
        const { data } = await api.get(`/student/session/${sessionCode}/exam-state`);
        const status = String(data.status || data.student_session?.status || "").toUpperCase();
        if (LOCKED_STATUSES.has(status)) {
          window.location.replace(`/react/student/results/${data.exam?.id || ""}`);
          return;
        }
        const normalizedQuestions = (data.questions || []).map(normalizeQuestion);
        const nextAnswers = {};
        const nextStdin = {};
        const nextOutputs = {};
        const nextTimeSpent = {};
        normalizedQuestions.forEach(question => {
          const saved = data.saved_answers?.[String(question.id)] || data.saved_answers?.[question.id] || question.answer || {};
          const normalizedAnswer = normalizeSavedAnswer(question, saved);
          nextAnswers[question.id] = normalizedAnswer;
          nextStdin[question.id] = "";
          nextTimeSpent[question.id] = Number(normalizedAnswer.time_spent_seconds || 0);
          if (normalizedAnswer.code_output) {
            nextOutputs[question.id] = {
              output: normalizedAnswer.code_output,
              error: "",
              timed_out: false,
              execution_time_seconds: saved.execution_time_seconds || null,
              status: saved.execution_status || "saved"
            };
          }
        });
        hasHydratedRef.current = true;
        setExamState(data);
        setSessionToken(data.session_token || data.attempt_token || "");
        setQuestions(normalizedQuestions);
        setAnswers(nextAnswers);
        setStdinValues(nextStdin);
        setRunOutputs(nextOutputs);
        questionTimeSpentRef.current = nextTimeSpent;
        setQuestionTimeSpent(nextTimeSpent);
        activeQuestionIdRef.current = normalizedQuestions[0]?.id || null;
        activeQuestionStartedAtRef.current = Date.now();
        setRemainingSeconds(Number(data.remaining_seconds || 0));
        setWarningCount(Number(data.warning_count ?? data.student_session?.focus_violations ?? 0));
        setMaxWarnings(Number(data.max_warnings || data.max_violations_allowed || 3));
        setPaused(Boolean(data.is_paused || data.student_session?.status === "paused"));
        if (data.admin_message) showAdminMessage(data.admin_message);
        window.setTimeout(requestFullscreen, 250);
      } catch (loadError) {
        const redirect = loadError.response?.data?.redirect;
        if (redirect) {
          window.location.replace(redirect);
          return;
        }
        setError(loadError.message || "Could not load your exam.");
      } finally {
        setLoading(false);
      }
    }

    loadExamState();
  }, [questionTimeSpentRef, requestFullscreen, sessionCode, showAdminMessage]);

  useEffect(() => {
    if (!hasHydratedRef.current) return undefined;
    if (forceSaveIntervalRef.current) window.clearInterval(forceSaveIntervalRef.current);
    forceSaveIntervalRef.current = window.setInterval(() => {
      const question = questionsRef.current[currentIndexRef.current];
      if (question) saveAnswerNow(question, answersRef.current[question.id] || emptyAnswer(), { silent: true });
    }, 30000);
    return () => window.clearInterval(forceSaveIntervalRef.current);
  }, [answersRef, currentIndexRef, questionsRef, saveAnswerNow]);

  useEffect(() => {
    const question = questions[currentIndex];
    if (!question || activeQuestionIdRef.current === question.id) return;
    activeQuestionIdRef.current = question.id;
    activeQuestionStartedAtRef.current = Date.now();
  }, [currentIndex, questions]);

  useEffect(() => {
    if (!sessionToken) return undefined;
    const intervalId = window.setInterval(sendHeartbeat, 20000);
    return () => window.clearInterval(intervalId);
  }, [sendHeartbeat, sessionToken]);

  useEffect(() => {
    if (paused || submitting || terminateOverlay) return undefined;
    const intervalId = window.setInterval(() => {
      setRemainingSeconds(current => {
        const next = Math.max(current - 1, 0);
        if (next === 300) {
          const alreadyShown = window.sessionStorage.getItem(fiveMinuteKey) === "true";
          if (!alreadyShown) {
            window.sessionStorage.setItem(fiveMinuteKey, "true");
            setFiveMinuteWarning(true);
            setFiveMinuteDismissProgress(100);
          }
        }
        if (next === 60) {
          setOneMinuteToast(true);
          window.setTimeout(() => setOneMinuteToast(false), 5000);
        }
        if (next === 0 && !autoSubmitStartedRef.current) {
          autoSubmitStartedRef.current = true;
          submitExam({ auto: true });
        }
        return next;
      });
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [fiveMinuteKey, paused, submitExam, submitting, terminateOverlay]);

  useEffect(() => {
    if (!fiveMinuteWarning) return undefined;
    let elapsed = 0;
    const intervalId = window.setInterval(() => {
      elapsed += 200;
      setFiveMinuteDismissProgress(Math.max(100 - (elapsed / 10000) * 100, 0));
      if (elapsed >= 10000) setFiveMinuteWarning(false);
    }, 200);
    return () => window.clearInterval(intervalId);
  }, [fiveMinuteWarning]);

  useEffect(() => {
    const onOffline = () => {
      setOnline(false);
      setOfflineBanner("You are offline. Answers are being saved locally.");
      setSaveState({ type: "offline", text: "Offline, buffering..." });
    };
    const onOnline = () => {
      setOnline(true);
      flushOfflineBuffer();
      sendHeartbeat();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, [flushOfflineBuffer, sendHeartbeat]);

  useEffect(() => {
    if (paused && !pausedToastShown) {
      setPausedToastShown(true);
      return;
    }
    if (!paused && pausedToastShown) {
      toast.success("Your exam has been resumed. Good luck!");
      setPausedToastShown(false);
    }
  }, [paused, pausedToastShown]);

  useEffect(() => {
    if (!sessionToken || !examState) return undefined;
    const socket = createRealtimeSocket();
    socket.on("connect", () => {
      socket.emit("student:join", { session_code: sessionCode, session_token: sessionToken });
    });
    socket.on("exam:terminated", () => setTerminateOverlay(true));
    socket.on("exam:paused", payload => {
      setPaused(true);
      if (payload?.message) showAdminMessage(payload.message);
    });
    socket.on("exam:resumed", payload => {
      setPaused(false);
      if (typeof payload?.remainingSeconds === "number") setRemainingSeconds(payload.remainingSeconds);
    });
    socket.on("exam:second_chance", payload => {
      setWarningCount(0);
      setWarningOverlay(null);
      setSecondChanceBanner(true);
      if (payload?.message) toast.success(payload.message);
      window.setTimeout(() => setSecondChanceBanner(false), 4000);
    });
    socket.on("exam:time_reduced", payload => {
      if (typeof payload?.newRemainingSeconds === "number") setRemainingSeconds(payload.newRemainingSeconds);
      toast("Exam time was adjusted by the administrator.");
    });
    socket.on("exam:admin_message", payload => showAdminMessage(payload?.message));
    socket.on("exam:submitted", payload => window.location.replace(payload?.redirect || `/react/student/results/${exam.id || ""}`));
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [exam.id, examState, sessionCode, sessionToken, showAdminMessage]);

  useEffect(() => {
    if (!sessionToken) return undefined;

    const onFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      setFullscreenBlocked(!active);
      if (!active && !submittingRef.current) {
        reportViolation("FULLSCREEN_EXIT", { detail: "Fullscreen was exited." });
        window.setTimeout(requestFullscreen, 250);
      }
    };

    const onKeyDown = event => {
      if (event.key === "Escape" && showSubmitConfirmRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
      const target = event.target;
      const editable = isEditableTarget(target);
      const key = String(event.key || "").toLowerCase();
      const ctrlOrMeta = event.ctrlKey || event.metaKey;
      const devToolsShortcut = event.key === "F12" || (ctrlOrMeta && event.shiftKey && ["i", "j", "c"].includes(key));
      const blockedShortcut = devToolsShortcut
        || (ctrlOrMeta && ["u", "s", "p", "w", "n", "t", "r"].includes(key))
        || (event.altKey && event.key === "F4")
        || event.key === "F5";
      if (blockedShortcut) {
        event.preventDefault();
        reportViolation(devToolsShortcut ? "DEVTOOLS_OPEN" : "KEYBOARD_SHORTCUT", { detail: `Blocked shortcut: ${event.key}` });
        return;
      }
      if (ctrlOrMeta && ["a", "c", "x", "v", "z"].includes(key) && editable) return;
      if (ctrlOrMeta && ["a", "c", "x", "v"].includes(key)) {
        event.preventDefault();
        reportViolation("KEYBOARD_SHORTCUT", { detail: `Blocked shortcut: ${event.key}` });
      }
    };

    const onContextMenu = event => {
      if (event.target instanceof window.Element && event.target.closest(".monaco-editor")) return;
      event.preventDefault();
      reportViolation("RIGHT_CLICK", { silent: true, detail: "Right click blocked." });
    };

    const onCopyCutPaste = event => {
      const target = event.target;
      const editable = isEditableTarget(target);
      if (editable) {
        if (event.type === "paste" && isTextAnswerTarget(target)) {
          reportViolation("PASTE_ATTEMPT", { silent: true, detail: "Paste inside answer field." });
        }
        return;
      }
      event.preventDefault();
      const type = event.type === "paste" ? "PASTE_ATTEMPT" : event.type === "cut" ? "COPY_ATTEMPT" : "COPY_ATTEMPT";
      reportViolation(type, { detail: `${event.type} blocked outside editable areas.` });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        reportViolation("TAB_SWITCH", { detail: "Tab became hidden." });
      }
    };
    const onBlur = () => reportViolation("WINDOW_BLUR", { detail: "Window lost focus.", throttleMs: 5000 });

    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("copy", onCopyCutPaste);
    document.addEventListener("cut", onCopyCutPaste);
    document.addEventListener("paste", onCopyCutPaste);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("blur", onBlur);

    const devtoolsInterval = window.setInterval(() => {
      if (window.outerHeight - window.innerHeight > 200 || window.outerWidth - window.innerWidth > 200) {
        reportViolation("DEVTOOLS_OPEN", { detail: "Developer tools size heuristic triggered.", throttleMs: 10000 });
      }
      const probe = {};
      Object.defineProperty(probe, "id", {
        get() {
          reportViolation("DEVTOOLS_OPEN", { detail: "Developer tools console inspection triggered.", throttleMs: 10000 });
          return "exam";
        }
      });
      console.debug(probe);
    }, 2000);

    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("copy", onCopyCutPaste);
      document.removeEventListener("cut", onCopyCutPaste);
      document.removeEventListener("paste", onCopyCutPaste);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("blur", onBlur);
      window.clearInterval(devtoolsInterval);
    };
  }, [reportViolation, requestFullscreen, sessionToken, showSubmitConfirmRef, submittingRef]);

  useEffect(() => {
    try {
      window.localStorage.setItem("exam_question_font_size", fontSizePreference);
    } catch {
      // Preference persistence is best effort.
    }
  }, [fontSizePreference]);

  useEffect(() => {
    if (!showSubmitConfirm) return undefined;
    const onModalEscape = event => {
      if (event.key === "Escape" && !submittingRef.current) setShowSubmitConfirm(false);
    };
    document.addEventListener("keydown", onModalEscape);
    return () => document.removeEventListener("keydown", onModalEscape);
  }, [showSubmitConfirm, submittingRef]);

  if (loading) {
    return <ExamLoading platformSettings={platformSettings} />;
  }

  if (error) {
    return (
      <div className="examWindow examWindowDark">
        <div className="examFatalState">
          <AlertTriangle size={36} />
          <h1>Exam unavailable</h1>
          <p>{error}</p>
          <button type="button" onClick={() => navigate("/student")}>Return to Dashboard</button>
        </div>
      </div>
    );
  }

  return (
    <div className="examWindow">
      <ExamHeader
        exam={exam}
        student={student}
        currentIndex={currentIndex}
        total={questions.length}
        remainingSeconds={remainingSeconds}
        currentStatus={currentAnswer.navigator_status}
        onToggleFlag={toggleFlag}
        onSubmit={openSubmitConfirm}
      />

      {offlineBanner && <div className={cn("examConnectivityBanner", online && "restored")}>{offlineBanner}</div>}

      <main className={cn("examContentZone", transitioning && "isTransitioning")}>
        <div className="examContentInner">
          <QuestionCard
            question={currentQuestion}
            answer={currentAnswer}
            runOutput={currentQuestion ? runOutputs[currentQuestion.id] : null}
            stdinValue={currentQuestion ? stdinValues[currentQuestion.id] || "" : ""}
            questionFontSize={questionFontSize}
            canWork={canWork}
            running={Boolean(currentQuestion && runningQuestionId === currentQuestion.id)}
            onAnswerChange={updateAnswer}
            onStdinChange={value => {
              if (!currentQuestion) return;
              setStdinValues(current => ({ ...current, [currentQuestion.id]: value }));
            }}
            onRun={runCode}
            onImageClick={setLightboxImage}
            onResizeStart={event => {
              terminalResizeRef.current = { startY: event.clientY };
            }}
          />

          <ExamCommandBar
            isFirst={currentIndex === 0}
            isLast={currentIndex === questions.length - 1}
            canWork={canWork}
            onPrevious={() => visitQuestion(currentIndex - 1)}
            onClear={clearCurrentAnswer}
            onMarkNext={markForReviewAndContinue}
            onSaveNext={saveAndContinue}
            onReviewSubmit={openSubmitConfirm}
          />

          <AutosaveStatus state={saveState} />
        </div>
      </main>

      <RightPanel
        exam={exam}
        student={student}
        questions={questions}
        answers={answers}
        currentIndex={currentIndex}
        counts={counts}
        answeredCount={answeredCount}
        reviewCount={reviewCount}
        progressPercent={progressPercent}
        remainingSeconds={remainingSeconds}
        fontSizePreference={fontSizePreference}
        onFontSizeChange={setFontSizePreference}
        onQuestionClick={index => {
          visitQuestion(index);
          setMobilePanelOpen(false);
        }}
        onSubmit={openSubmitConfirm}
      />

      <button type="button" className="examMobileNavigatorButton" onClick={() => setMobilePanelOpen(true)} aria-label="Open question navigator">
        <Grid3X3 size={22} />
        {unansweredCount > 0 && <span>{unansweredCount}</span>}
      </button>

      {mobilePanelOpen && (
        <MobileQuestionSheet onClose={() => setMobilePanelOpen(false)}>
          <RightPanel
            exam={exam}
            student={student}
            questions={questions}
            answers={answers}
            currentIndex={currentIndex}
            counts={counts}
            answeredCount={answeredCount}
            reviewCount={reviewCount}
            progressPercent={progressPercent}
            remainingSeconds={remainingSeconds}
            fontSizePreference={fontSizePreference}
            onFontSizeChange={setFontSizePreference}
            onQuestionClick={index => {
              visitQuestion(index);
              setMobilePanelOpen(false);
            }}
            onSubmit={openSubmitConfirm}
            mobile
          />
        </MobileQuestionSheet>
      )}

      {showSubmitConfirm && (
        <SubmitModal
          counts={counts}
          questions={questions}
          answers={answers}
          total={questions.length}
          remainingSeconds={remainingSeconds}
          submitting={submitting}
          submitError={submitErrorMessage}
          getTimeSpent={getQuestionTimeSpentSeconds}
          onClose={() => setShowSubmitConfirm(false)}
          onJump={index => {
            setShowSubmitConfirm(false);
            visitQuestion(index);
          }}
          onSubmit={() => submitExam({ auto: false })}
        />
      )}

      {fiveMinuteWarning && (
        <FiveMinuteWarning
          answered={answeredCount}
          total={questions.length}
          progress={fiveMinuteDismissProgress}
          onContinue={() => setFiveMinuteWarning(false)}
        />
      )}

      {oneMinuteToast && <div className="examOneMinuteToast">1 minute remaining!</div>}

      {warningOverlay && (
        <ViolationWarningOverlay
          warning={warningOverlay}
          onClose={() => setWarningOverlay(null)}
        />
      )}

      {adminMessage && <AdminMessageOverlay message={adminMessage} onDismiss={() => setAdminMessage(null)} />}
      {paused && <PauseOverlay />}
      {terminateOverlay && <TerminateOverlay onDashboard={() => navigate("/student")} />}
      {secondChanceBanner && <SecondChanceBanner />}
      {lightboxImage && <ImageLightbox imageUrl={lightboxImage} onClose={() => setLightboxImage(null)} />}
      {(fullscreenBlocked || !isFullscreen) && examState && !showSubmitConfirm && !timeUpSubmitting && (
        <FullscreenGate onEnter={requestFullscreen} onSubmit={openSubmitConfirm} />
      )}
      {timeUpSubmitting && <TimeUpOverlay error={error} />}
    </div>
  );
}

function ExamLoading({ platformSettings }) {
  return (
    <div className="examLoadingScreen">
      <PlatformLogo src={platformSettings?.logo_url} name={platformSettings?.platform_name || "Exam Platform"} size="lg" rounded="full" />
      <span className="examSpinner" />
      <p>Loading your exam...</p>
      <div className="examSkeletonCard">
        <span />
        <strong />
        <em />
        <i />
        <i />
        <i />
      </div>
    </div>
  );
}

function ExamHeader({ exam, student, currentIndex, total, remainingSeconds, currentStatus, onToggleFlag, onSubmit }) {
  return (
    <header className="examHeaderBar">
      <div className="examHeaderLeft">
        <h1>{exam.title || exam.exam_name || "Exam"}</h1>
        <span className="examHeaderDivider" />
        <span>{student.name || "Student"}</span>
        <span>Roll: {student.roll_number || "-"}</span>
        <span>Set: {exam.set_code || "-"}</span>
      </div>
      <TimerPill seconds={remainingSeconds} />
      <div className="examHeaderRight">
        <span>Q {Math.min(currentIndex + 1, total)} / {total}</span>
        <Tooltip label="Flag for review">
          <button type="button" className={cn("examFlagButton", isMarked(currentStatus) && "active")} onClick={onToggleFlag} aria-label="Flag for review">
            <Bookmark size={17} />
          </button>
        </Tooltip>
        <button type="button" className="examHeaderSubmit" onClick={onSubmit}>Submit Exam</button>
      </div>
    </header>
  );
}

function TimerPill({ seconds }) {
  const state = seconds <= 60 ? "danger" : seconds <= 120 ? "critical" : seconds <= 600 ? "warning" : "normal";
  return (
    <div className={cn("examTimerPill", state, seconds < 60 && seconds % 10 === 0 && "shake")}>
      {formatTime(seconds)}
    </div>
  );
}

function ExamCommandBar({ isFirst, isLast, canWork, onPrevious, onClear, onMarkNext, onSaveNext, onReviewSubmit }) {
  return (
    <div className="examCommandBar">
      <div className="examCommandGroup">
        <button type="button" className="examCommandButton neutral" disabled={isFirst} onClick={onPrevious}>
          <ChevronLeft size={16} /> Previous
        </button>
        <button type="button" className="examCommandButton neutral" disabled={!canWork} onClick={onClear}>
          <Eraser size={16} /> Clear Response
        </button>
      </div>
      <div className="examCommandGroup primary">
        <button type="button" className="examCommandButton review" disabled={!canWork} onClick={onMarkNext}>
          <Bookmark size={16} /> Mark for Review & Next
        </button>
        <button type="button" className={cn("examCommandButton save", isLast && "final")} onClick={isLast ? onReviewSubmit : onSaveNext}>
          {isLast ? <Check size={16} /> : <Save size={16} />}
          {isLast ? "Review & Submit" : "Save & Next"}
          {!isLast && <ChevronRight size={16} />}
        </button>
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  answer,
  runOutput,
  stdinValue,
  questionFontSize,
  canWork,
  running,
  onAnswerChange,
  onStdinChange,
  onRun,
  onImageClick
}) {
  if (!question) return <QuestionSkeleton />;
  const isLong = question.type === "long";
  const wordCount = String(answer.answer_text || "").trim() ? String(answer.answer_text || "").trim().split(/\s+/).length : 0;

  const prompt = (
    <QuestionPrompt
      question={question}
      questionFontSize={questionFontSize}
      onImageClick={onImageClick}
    />
  );

  if (question.type === "code") {
    return (
      <article className="examQuestionCard examQuestionCardCode">
        <section className="examPromptPane">{prompt}</section>
        <section className="examAnswerPane" aria-label="Code answer workspace">
          <CodeAnswer
            question={question}
            answer={answer}
            stdinValue={stdinValue}
            runOutput={runOutput}
            canWork={canWork}
            running={running}
            onChange={value => onAnswerChange(question, { code_text: value })}
            onStdinChange={onStdinChange}
            onRun={() => onRun(question)}
          />
        </section>
      </article>
    );
  }

  return (
    <article className="examQuestionCard">
      {prompt}

      <div className="examAnswerDivider" />

      {question.type === "mcq" && (
        <div className="examMcqOptions">
          {question.options.map((option, index) => {
            const selected = answer.selected_option === option.id || answer.selected_option === option.text;
            return (
              <button
                type="button"
                key={`${option.id}-${index}`}
                className={cn("examMcqOption", selected && "selected")}
                disabled={!canWork}
                onClick={() => onAnswerChange(question, { selected_option: option.id })}
              >
                <span>{optionLabel(index)}</span>
                <strong>{option.text}</strong>
              </button>
            );
          })}
        </div>
      )}

      {(question.type === "short" || question.type === "long") && (
        <label className="examTextAnswer">
          <textarea
            data-answer-textarea="true"
            aria-label={isLong ? "Long answer" : "Short answer"}
            value={answer.answer_text || ""}
            disabled={!canWork}
            rows={isLong ? 10 : 5}
            onChange={event => onAnswerChange(question, { answer_text: event.target.value })}
            style={{ minHeight: isLong ? 200 : 100, maxHeight: isLong ? 500 : 300 }}
          />
          <span>{isLong ? `${wordCount} words` : `${String(answer.answer_text || "").length} characters`}</span>
        </label>
      )}
    </article>
  );
}

function QuestionSkeleton() {
  return (
    <article className="examQuestionCard examQuestionSkeleton">
      <span />
      <strong />
      <strong />
      <i />
      <i />
      <i />
      <i />
    </article>
  );
}

function QuestionPrompt({ question, questionFontSize, onImageClick }) {
  return (
    <>
      <header className="examQuestionHeader">
        <div>
          <span>Question {question.order_index}</span>
          <b>{question.marks} marks</b>
        </div>
        <em>{questionTypeLabel(question.type)}</em>
      </header>

      <section className="examQuestionBody question-content" style={{ "--question-font-size": `${questionFontSize}px` }}>
        <p>{renderInlineMarkdown(question.question_text)}</p>
        {question.image_urls?.length > 0 && (
          <div className="examQuestionImages">
            {question.image_urls.map(url => (
              <button type="button" key={url} onClick={() => onImageClick(url)} aria-label="Open question image">
                <img src={url} alt={`Question ${question.order_index}`} />
              </button>
            ))}
          </div>
        )}
        {question.code_snippet && <ReferenceCode code={question.code_snippet} />}
      </section>
    </>
  );
}

function ReferenceCode({ code }) {
  const height = Math.min(Math.max(String(code).split(/\r?\n/).length * 20 + 34, 120), 360);
  return (
    <div className="examReferenceCode">
      <span>Reference Code</span>
      <Editor
        height={height}
        language="python"
        theme="vs-dark"
        value={code}
        options={{
          readOnly: true,
          domReadOnly: true,
          minimap: { enabled: false },
          lineNumbers: "off",
          renderLineHighlight: "none",
          scrollBeyondLastLine: false,
          cursorStyle: "line-thin",
          automaticLayout: true,
          folding: false,
          ariaLabel: "Reference code"
        }}
      />
    </div>
  );
}

function CodeAnswer({ question, answer, stdinValue, runOutput, canWork, running, onChange, onStdinChange, onRun }) {
  const [editorHeight, setEditorHeight] = useState(320);
  const resizeRef = useRef(null);

  const startResize = event => {
    event.preventDefault();
    resizeRef.current = { startY: event.clientY, startHeight: editorHeight };
    const onMove = moveEvent => {
      if (!resizeRef.current) return;
      setEditorHeight(Math.min(Math.max(resizeRef.current.startHeight + moveEvent.clientY - resizeRef.current.startY, 240), 560));
    };
    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div className="examCodeAnswer">
      <section>
        <label>Your Code</label>
        <div className="examCodeEditor" style={{ height: editorHeight }}>
          <Editor
            height="100%"
            language="python"
            theme="vs-dark"
            value={answer.code_text || ""}
            onChange={value => onChange(value || "")}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
              lineNumbers: "on",
              wordWrap: "off",
              autoClosingBrackets: "always",
              formatOnPaste: false,
              scrollBeyondLastLine: false,
              automaticLayout: true,
              readOnly: !canWork,
              ariaLabel: "Code answer editor"
            }}
          />
          <button type="button" className="examEditorResize" onPointerDown={startResize} aria-label="Resize code editor" />
        </div>
      </section>

      <section className="examStdinBlock">
        <label htmlFor={`stdin-${question.id}`}>Standard Input (stdin)</label>
        <small id={`stdin-help-${question.id}`}>If your code uses input(), type values here, one per line</small>
        <textarea
          id={`stdin-${question.id}`}
          data-stdin-input="true"
          aria-describedby={`stdin-help-${question.id}`}
          value={stdinValue}
          disabled={!canWork}
          rows={3}
          spellCheck="false"
          onChange={event => onStdinChange(event.target.value)}
        />
      </section>

      <section className="examRunBlock">
        <button type="button" className="examRunButton" disabled={!canWork || running} onClick={onRun}>
          {running ? <LoaderCircle size={16} className="spin" /> : <Play size={16} />}
          {running ? "Running..." : "Run Code"}
        </button>
        <TerminalPanel output={runOutput} timeoutSeconds={question.execution_time_limit_seconds} />
      </section>
    </div>
  );
}

function TerminalPanel({ output, timeoutSeconds }) {
  const terminalHostRef = useRef(null);
  const terminalRef = useRef(null);
  const content = useMemo(
    () => output || { output: "", error: "", timed_out: false, execution_time_seconds: null, status: "idle" },
    [output]
  );

  useEffect(() => {
    if (!terminalHostRef.current) return undefined;
    const terminal = new Terminal({
      cols: 80,
      rows: 9,
      convertEol: true,
      cursorBlink: false,
      disableStdin: true,
      theme: {
        background: "#0d1117",
        foreground: "#d1d5db",
        red: "#f87171",
        green: "#bbf7d0",
        yellow: "#fcd34d"
      },
      fontFamily: "JetBrains Mono, Fira Code, Consolas, monospace",
      fontSize: 12
    });
    terminal.open(terminalHostRef.current);
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
    if (content.status === "idle") {
      terminal.writeln("Run output will appear here.");
      return;
    }
    if (content.status === "running") {
      terminal.writeln("Running...");
      return;
    }
    if (content.timed_out) terminal.writeln(`\x1b[33mExecution timed out after ${timeoutSeconds}s\x1b[0m`);
    if (content.error) terminal.writeln(`\x1b[31m${content.error}\x1b[0m`);
    if (content.output) terminal.writeln(`\x1b[92m${content.output}\x1b[0m`);
    if (!content.output && !content.error && !content.timed_out) terminal.writeln("Execution completed with no output.");
  }, [content, timeoutSeconds]);

  return (
    <div className="examTerminalWrap">
      <div ref={terminalHostRef} className="examTerminal" />
      {content.execution_time_seconds !== null && content.execution_time_seconds !== undefined && (
        <span>Ran in {Number(content.execution_time_seconds).toFixed(2)}s</span>
      )}
    </div>
  );
}

function AutosaveStatus({ state }) {
  return (
    <div className={cn("examAutosaveStatus", state.type)}>
      <i />
      <span>{state.text}</span>
    </div>
  );
}

function RightPanel({
  exam,
  student,
  questions,
  answers,
  currentIndex,
  counts,
  answeredCount,
  reviewCount,
  progressPercent,
  remainingSeconds,
  fontSizePreference,
  onFontSizeChange,
  onQuestionClick,
  onSubmit,
  mobile = false
}) {
  return (
    <aside className={cn("examRightPanel", mobile && "mobile")}>
      <section className="examStudentStrip">
        <span>{getInitials(student.name)}</span>
        <div>
          <strong>{student.name || "Student"}</strong>
          <small>Roll: {student.roll_number || "-"} | Set: {exam.set_code || "-"}</small>
        </div>
      </section>

      <section className="examFontControls" aria-label="Question font size">
        {[
          ["small", "A-"],
          ["medium", "A"],
          ["large", "A+"]
        ].map(([value, label]) => (
          <button type="button" key={value} className={fontSizePreference === value ? "active" : ""} onClick={() => onFontSizeChange(value)}>
            {label}
          </button>
        ))}
      </section>

      <section className="examProgressSummary">
        <h2>Progress</h2>
        <StatRow icon={<Check size={15} />} label="Answered" value={answeredCount} tone="green" />
        <StatRow icon={<Circle size={15} />} label="Not Answered" value={counts[STATUS.VISITED_UNANSWERED] || 0} tone="red" />
        <StatRow icon={<Circle size={15} />} label="Not Visited" value={counts[STATUS.NOT_VISITED] || 0} tone="gray" />
        <StatRow icon={<Bookmark size={15} />} label="Marked for Review" value={reviewCount} tone="amber" />
        <div className="examProgressBar"><span style={{ width: `${progressPercent}%` }} /></div>
      </section>

      <section className="examQuestionNavigator">
        <h2>Questions</h2>
        <div className="examLegend">
          {STATUS_ORDER.map(status => (
            <span key={status}><i className={`status-${status.toLowerCase().replaceAll("_", "-")}`} />{STATUS_LABELS[status]}</span>
          ))}
        </div>
        <div className="examNavigatorGrid">
          {questions.map((question, index) => {
            const status = normalizeStatus((answers[question.id] || emptyAnswer()).navigator_status);
            return (
              <button
                type="button"
                key={question.id}
                className={cn(`status-${status.toLowerCase().replaceAll("_", "-")}`, index === currentIndex && "current")}
                onClick={() => onQuestionClick(index)}
              >
                {question.order_index}
              </button>
            );
          })}
        </div>
      </section>

      <section className={cn("examSideTimer", remainingSeconds <= 300 && "pulse", remainingSeconds <= 600 && "warning", remainingSeconds <= 300 && "danger")}>
        <strong>{formatTime(remainingSeconds)}</strong>
        <span>remaining</span>
      </section>

      <button type="button" className="examPanelSubmit" onClick={onSubmit}>Submit Exam</button>
    </aside>
  );
}

function StatRow({ icon, label, value, tone }) {
  return (
    <div className={`examStatRow ${tone}`}>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MobileQuestionSheet({ children, onClose }) {
  return (
    <div className="examMobileSheetHost">
      <button type="button" className="examMobileSheetBackdrop" onClick={onClose} aria-label="Close question panel" />
      <section className="examMobileSheet">
        <div className="examSheetHandle" />
        <button type="button" className="examSheetClose" onClick={onClose} aria-label="Close question panel"><X size={18} /></button>
        {children}
      </section>
    </div>
  );
}

function SubmitModal({ counts, questions, answers, total, remainingSeconds, submitting, submitError, getTimeSpent, onClose, onJump, onSubmit }) {
  const [filter, setFilter] = useState("all");
  const notAnswered = counts[STATUS.VISITED_UNANSWERED] || 0;
  const notVisited = counts[STATUS.NOT_VISITED] || 0;
  const unanswered = notAnswered + notVisited;
  const reviewRows = useMemo(() => questions.map((question, index) => {
    const answer = answers[question.id] || emptyAnswer();
    const status = normalizeStatus(answer.navigator_status);
    return {
      id: question.id,
      index,
      number: question.order_index || index + 1,
      type: questionTypeLabel(question.type),
      status,
      answered: hasAnswer(question, answer),
      timeSpentSeconds: getTimeSpent ? getTimeSpent(question.id) : Number(answer.time_spent_seconds || 0)
    };
  }), [answers, getTimeSpent, questions]);
  const filteredRows = reviewRows.filter(row => filter === "all" || row.status === filter);
  const filterOptions = [
    ["all", "All", total],
    [STATUS.ANSWERED, "Answered", counts[STATUS.ANSWERED] || 0],
    [STATUS.VISITED_UNANSWERED, "Skipped", notAnswered],
    [STATUS.NOT_VISITED, "Unseen", notVisited],
    [STATUS.MARKED_REVIEW, "Review", counts[STATUS.MARKED_REVIEW] || 0],
    [STATUS.ANSWERED_MARKED, "Done + Review", counts[STATUS.ANSWERED_MARKED] || 0]
  ];
  return (
    <div className="examModalBackdrop submit" role="presentation" onClick={() => {
      if (!submitting) onClose();
    }}>
      <section className="examSubmitModal" role="dialog" aria-modal="true" onClick={event => event.stopPropagation()}>
        <i />
        <header>
          <h2>Final Review</h2>
          <p>Check the question palette carefully before submitting. This action cannot be undone.</p>
        </header>
        <div className="examSubmitStats">
          <SubmitStat label="Answered" value={counts[STATUS.ANSWERED] || 0} tone="green" />
          <SubmitStat label="Not Answered" value={notAnswered} tone="red" warn={notAnswered > 0} />
          <SubmitStat label="Not Visited" value={notVisited} tone="gray" warn={notVisited > 0} />
          <SubmitStat label="Marked for Review" value={counts[STATUS.MARKED_REVIEW] || 0} tone="amber" />
          <SubmitStat label="Answered + Marked" value={counts[STATUS.ANSWERED_MARKED] || 0} tone="blue" />
          <SubmitStat label="Total Questions" value={total} tone="gray" />
        </div>
        {unanswered > 0 && (
          <div className="examSubmitWarning">
            <AlertTriangle size={16} />
            You have {unanswered} unanswered questions. Once submitted, you cannot return to this exam.
          </div>
        )}
        <div className="examFinalReview">
          <div className="examFinalReviewFilters">
            {filterOptions.map(([value, label, count]) => (
              <button
                type="button"
                key={value}
                className={filter === value ? "active" : ""}
                onClick={() => setFilter(value)}
              >
                <span>{label}</span>
                <strong>{count}</strong>
              </button>
            ))}
          </div>
          <div className="examFinalReviewList">
            {filteredRows.map(row => (
              <button type="button" key={row.id} onClick={() => onJump(row.index)}>
                <span className={`examReviewStatusDot status-${row.status.toLowerCase().replaceAll("_", "-")}`} />
                <strong>Q{row.number}</strong>
                <em>{STATUS_LABELS[row.status]}</em>
                <small>{row.type}</small>
                <b>{formatDuration(row.timeSpentSeconds)}</b>
              </button>
            ))}
            {filteredRows.length === 0 && <p>No questions in this group.</p>}
          </div>
        </div>
        <div className="examTimeRemainingRow">Time Remaining: <strong>{formatTime(remainingSeconds)}</strong></div>
        {submitError && (
          <div className="examSubmitError">
            <AlertTriangle size={15} />
            {submitError}
          </div>
        )}
        <footer>
          <button type="button" className="examGhostButton" disabled={submitting} onClick={onClose}>Go Back</button>
          <button type="button" className="examDangerButton" disabled={submitting} onClick={onSubmit}>
            {submitting && <LoaderCircle size={16} className="spin" />} Submit Exam
          </button>
        </footer>
      </section>
    </div>
  );
}

function SubmitStat({ label, value, tone, warn = false }) {
  return (
    <div className={`examSubmitStat ${tone}`}>
      <span>{warn && <AlertTriangle size={13} />}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function FiveMinuteWarning({ answered, total, progress, onContinue }) {
  const remaining = Math.max(total - answered, 0);
  return (
    <div className="examModalBackdrop">
      <section className="examFiveMinuteModal">
        <i />
        <Clock3 size={40} />
        <h2>5 Minutes Remaining</h2>
        <p>Please review your answers and make sure you have attempted all questions. Your exam will auto-submit when the time runs out.</p>
        <div><span>Questions Answered:</span><strong>{answered} / {total}</strong></div>
        <div className={remaining > 0 ? "danger" : ""}><span>Questions Remaining:</span><strong>{remaining}</strong></div>
        <button type="button" onClick={onContinue}>Continue Exam</button>
        <em><span style={{ width: `${progress}%` }} /></em>
      </section>
    </div>
  );
}

function ViolationWarningOverlay({ warning, onClose }) {
  const count = Math.min(warning.count || 1, warning.max || 3);
  const max = warning.max || 3;
  const tone = count >= max ? "red" : count === 2 ? "orange" : "amber";
  const title = count >= max ? `Warning ${count} of ${max} - Administrator Notified` : count === 2 ? `Warning ${count} of ${max} - Final Notice` : `Warning ${count} of ${max}`;
  const body = count >= max
    ? "You have reached the maximum number of warnings. Your exam administrator has been alerted and will decide whether your exam continues. Please wait."
    : count === 2
      ? "This is your second violation. One more violation may result in your exam being terminated. The administrator has been notified."
      : "You have exited the exam window. This has been recorded and reported to the exam administrator. Please remain in fullscreen mode during the exam.";
  return (
    <div className="examViolationBackdrop">
      <section className={`examViolationCard ${tone}`}>
        <i />
        <div className="examWarningSteps">
          {Array.from({ length: max }).map((_, index) => (
            <span key={index} className={cn(index + 1 < count && "done", index + 1 === count && "current")} />
          ))}
        </div>
        {count >= max ? <ShieldX size={36} /> : <AlertTriangle size={36} />}
        <h2>{title}</h2>
        <p>{body}</p>
        <button type="button" onClick={onClose}>{count >= max ? "Return to Exam" : "I Understand, Continue Exam"}</button>
        {count >= max && <small>Your answers have been saved up to this point.</small>}
      </section>
    </div>
  );
}

function AdminMessageOverlay({ message, onDismiss }) {
  return (
    <div className="examAdminMessage">
      <Bell size={18} />
      <div>
        <strong>Message from Administrator:</strong>
        <p>{message}</p>
      </div>
      <button type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

function PauseOverlay() {
  return (
    <div className="examPauseOverlay">
      <section>
        <Pause size={40} />
        <h2>Exam Paused</h2>
        <p>Your exam has been temporarily paused by the administrator. The timer is frozen. Please wait.</p>
        <span><LoaderCircle size={16} className="spin" /> Waiting for administrator to resume...</span>
      </section>
    </div>
  );
}

function TerminateOverlay({ onDashboard }) {
  return (
    <div className="examTerminateOverlay">
      <section>
        <i />
        <h2>Exam Terminated</h2>
        <p>Your exam session has been ended by the administrator.</p>
        <button type="button" onClick={onDashboard}>Return to Dashboard</button>
      </section>
    </div>
  );
}

function SecondChanceBanner() {
  return (
    <div className="examSecondChanceBanner">
      <Check size={18} />
      Second chance granted by administrator. Continue your exam.
    </div>
  );
}

function ImageLightbox({ imageUrl, onClose }) {
  return (
    <div className="examLightbox" role="presentation" onClick={onClose}>
      <button type="button" onClick={onClose} aria-label="Close image"><X size={22} /></button>
      <img src={imageUrl} alt="Question enlarged" onClick={event => event.stopPropagation()} />
    </div>
  );
}

function FullscreenGate({ onEnter, onSubmit }) {
  return (
    <div className="examFullscreenGate">
      <section>
        <Maximize2 size={40} />
        <h2>Please enable fullscreen to begin</h2>
        <p>The exam stays in a dedicated monitored window. If your browser blocks fullscreen, use the button below to retry.</p>
        <div className="examFullscreenActions">
          <button type="button" onClick={onEnter}>Enter Fullscreen</button>
          <button type="button" className="examGateSubmit" onClick={onSubmit}>Submit Exam</button>
        </div>
      </section>
    </div>
  );
}

function TimeUpOverlay({ error }) {
  return (
    <div className="examTimeUpOverlay">
      <section>
        <LoaderCircle size={36} className="spin" />
        <h2>Time&apos;s up! Submitting your exam...</h2>
        {error && <p>{error}</p>}
      </section>
    </div>
  );
}
