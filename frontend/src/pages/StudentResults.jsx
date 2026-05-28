import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Download,
  FileText,
  MessageSquare,
  ShieldCheck,
  Target,
  X,
  XCircle
} from "lucide-react";
import Editor from "@monaco-editor/react";
import "../monacoSetup.js";
import { Badge, Button, Card, Skeleton } from "../components/ui";
import { api } from "../services/api";
import { formatDateShort } from "../utils/dateFormat";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

function getResultStatus(result) {
  const passing = Number(result?.passing_percentage ?? 40);
  const percentage = Number(result?.percentage ?? 0);
  const passed = typeof result?.passed === "boolean"
    ? result.passed
    : result?.status
      ? String(result.status).toLowerCase() === "passed"
      : percentage >= passing;
  return {
    passed,
    passing,
    label: passed ? "PASSED" : "FAILED",
    variant: passed ? "success" : "danger"
  };
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(Math.floor(Number(seconds) || 0), 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  if (minutes <= 0) return `${remainder}s`;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

function integrityVariant(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("clear")) return "success";
  if (normalized.includes("admin")) return "danger";
  return "warning";
}

export default function StudentResults() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedQuestion, setExpandedQuestion] = useState(null);
  const [lightboxImage, setLightboxImage] = useState(null);

  const loadResults = useCallback(async (soft = false) => {
    if (!soft) setLoading(true);
    try {
      const { data } = await api.get("/student/results");
      setResults(data.results || []);
    } catch {
      // Keep the previous results on transient realtime refresh failures.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadResults();
  }, [loadResults]);
  useLiveRefresh(loadResults, { intervalMs: 25000 });

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold text-text-muted">STUDENT RESULTS</p>
          <h1 className="text-3xl font-bold text-text-primary">Published Results</h1>
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold text-text-muted">STUDENT RESULTS</p>
          <h1 className="text-3xl font-bold text-text-primary">Published Results</h1>
        </div>
        <Card className="p-12 text-center">
          <FileText size={40} className="mx-auto mb-4 text-text-muted" />
          <h3 className="text-lg font-semibold text-text-primary">No results yet</h3>
          <p className="mt-2 text-text-secondary">Your exam results will appear here once they are published by your teacher.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold text-text-muted">STUDENT RESULTS</p>
        <h1 className="text-3xl font-bold text-text-primary">Published Results</h1>
      </div>

      <div className="grid gap-6">
        {results.map(result => (
          <ResultCard
            key={result.id}
            result={result}
            expanded={expandedQuestion === result.id}
            onToggle={() => setExpandedQuestion(expandedQuestion === result.id ? null : result.id)}
            onImageClick={setLightboxImage}
          />
        ))}
      </div>

      {lightboxImage && (
        <button
          type="button"
          className="fixed inset-0 z-[80] flex cursor-zoom-out items-center justify-center bg-black/85 p-4 animate-page-fade"
          onClick={() => setLightboxImage(null)}
          aria-label="Close image preview"
        >
          <X className="absolute right-5 top-5 text-white" size={28} />
          <img
            src={lightboxImage}
            alt=""
            className="max-h-[90vh] max-w-[92vw] rounded-lg object-contain shadow-elevated animate-lightbox-image"
            onClick={event => event.stopPropagation()}
          />
        </button>
      )}
    </div>
  );
}

function ResultCard({ result, expanded, onToggle, onImageClick }) {
  const resultStatus = getResultStatus(result);
  const analytics = result.analytics || {};
  const durationSeconds = result.time_taken_seconds || analytics.session_duration_seconds || analytics.time_spent_seconds || 0;
  return (
    <Card>
      {/* Header */}
      <div
        className="flex cursor-pointer items-center justify-between border-b border-border/50 p-6 hover:bg-background-elevated/50"
        onClick={onToggle}
      >
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-semibold text-text-primary">{result.exam_name}</h3>
          <p className="text-sm text-text-secondary">
              {result.submitted_at ? `Submitted on ${formatDateShort(result.submitted_at)}` : "Submission date unavailable"}
              {result.teacher_name ? ` by ${result.teacher_name}` : ""}
            </p>
        </div>
        <div className="ml-4 flex items-center gap-4">
          <ScoreDisplay result={result} />
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="space-y-4 p-6">
          {/* Detailed Breakdown */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs font-semibold text-text-muted">TOTAL SCORE</p>
              <p className="text-2xl font-bold text-text-primary">
                {result.total_marks_obtained}/{result.total_marks}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-muted">PERCENTAGE</p>
              <p className="text-2xl font-bold text-text-primary">{result.percentage}%</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-muted">STATUS</p>
              <Badge
                variant={resultStatus.variant}
                className="mt-1"
              >
                {resultStatus.label}
              </Badge>
              <p className="mt-1 text-xs text-text-muted">Pass mark {resultStatus.passing}%</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-muted">DURATION</p>
              <p className="text-lg font-bold text-text-primary">{durationSeconds ? formatDuration(durationSeconds) : "-"}</p>
            </div>
          </div>

          <ResultAnalytics analytics={analytics} totalQuestions={result.questions?.length || 0} />

          {result.teacher_remarks && (
            <div className="flex gap-3 rounded-lg border border-info/30 bg-info/5 p-4 text-sm text-text-secondary">
              <MessageSquare className="mt-0.5 shrink-0 text-info" size={18} />
              <p>{result.teacher_remarks}</p>
            </div>
          )}

          <CategoryBreakdown categories={analytics.category_breakdown || []} />

          {analytics.recommendations?.length > 0 && (
            <div className="rounded-lg border border-brand-primary/20 bg-brand-primary/5 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
                <Target size={17} className="text-brand-primary" />
                Study focus
              </div>
              <div className="grid gap-2 md:grid-cols-2">
                {analytics.recommendations.map(item => (
                  <div key={item} className="rounded-md border border-border/50 bg-background-base px-3 py-2 text-sm text-text-secondary">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Questions Breakdown */}
          <div className="border-t border-border/50 pt-4">
            <h4 className="mb-4 font-semibold text-text-primary">Question Breakdown</h4>
            <div className="space-y-3">
              {result.questions?.map((question, index) => (
                <QuestionResult key={question.id || index} question={question} index={index + 1} onImageClick={onImageClick} />
              ))}
            </div>
          </div>

          {/* Download PDF */}
          {result.pdf_url && (
            <div className="flex flex-wrap gap-2 border-t border-border/50 pt-4">
              <Button as="a" href={result.pdf_url} variant="primary" size="sm">
                <Download size={16} /> Download PDF Report
              </Button>
              {result.certificate_url && (
                <Button as="a" href={result.certificate_url} variant="secondary" size="sm">
                  <Download size={16} /> Download Certificate
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ResultAnalytics({ analytics, totalQuestions }) {
  if (!analytics || Object.keys(analytics).length === 0) return null;
  const unanswered = analytics.unanswered_count ?? Math.max(totalQuestions - Number(analytics.answered_count || 0), 0);
  return (
    <div className="grid gap-3 md:grid-cols-4">
      <AnalyticsTile
        icon={CheckCircle2}
        label="Answered"
        value={`${analytics.answered_count || 0}/${analytics.total_questions || totalQuestions}`}
        accent="text-success"
      />
      <AnalyticsTile
        icon={AlertTriangle}
        label="Unanswered"
        value={unanswered}
        accent={unanswered > 0 ? "text-warning" : "text-success"}
      />
      <AnalyticsTile
        icon={Clock3}
        label="Work Time"
        value={formatDuration(analytics.time_spent_seconds || 0)}
        detail={`Avg ${formatDuration(analytics.average_time_per_question_seconds || 0)}/Q`}
        accent="text-info"
      />
      <AnalyticsTile
        icon={ShieldCheck}
        label="Integrity"
        value={analytics.integrity_status || "Clear"}
        detail={`${analytics.warning_count || 0}/${analytics.max_warnings || 3} warnings`}
        badgeVariant={integrityVariant(analytics.integrity_status)}
        accent="text-brand-primary"
      />
    </div>
  );
}

function AnalyticsTile({ icon: Icon, label, value, detail, accent, badgeVariant }) {
  return (
    <div className="rounded-lg border border-border/50 bg-background-elevated/40 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
        <Icon size={18} className={accent} />
      </div>
      {badgeVariant ? (
        <Badge variant={badgeVariant} size="md">{value}</Badge>
      ) : (
        <p className="text-xl font-bold text-text-primary">{value}</p>
      )}
      {detail && <p className="mt-2 text-xs text-text-muted">{detail}</p>}
    </div>
  );
}

function CategoryBreakdown({ categories }) {
  if (!categories.length) return null;
  return (
    <div className="rounded-lg border border-border/50 bg-background-elevated/30 p-4">
      <div className="mb-4 flex items-center gap-2">
        <BarChart3 size={18} className="text-brand-primary" />
        <h4 className="font-semibold text-text-primary">Category Performance</h4>
      </div>
      <div className="space-y-3">
        {categories.map(category => {
          const percentage = Math.max(0, Math.min(Number(category.percentage || 0), 100));
          return (
            <div key={category.label} className="rounded-lg border border-border/50 bg-background-base p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-text-primary">{category.label}</p>
                  <p className="text-xs text-text-muted">
                    {category.answered}/{category.questions} answered · avg {formatDuration(category.average_time_seconds || 0)}
                  </p>
                </div>
                <Badge variant={percentage >= 70 ? "success" : percentage >= 40 ? "warning" : "danger"}>
                  {category.marks_obtained}/{category.max_marks} marks
                </Badge>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-background-elevated">
                <div
                  className="h-full rounded-full bg-brand-primary transition-all duration-500"
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <p className="mt-1 text-right text-xs font-semibold text-text-muted">{percentage}%</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScoreDisplay({ result }) {
  const percentage = result.percentage || 0;
  const resultStatus = getResultStatus(result);
  const [animatedPercentage, setAnimatedPercentage] = useState(0);
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (animatedPercentage / 100) * circumference;
  const color = resultStatus.passed ? "rgb(var(--color-success))" : "rgb(var(--color-danger))";

  useEffect(() => {
    const id = window.requestAnimationFrame(() => setAnimatedPercentage(Math.max(0, Math.min(percentage, 100))));
    return () => window.cancelAnimationFrame(id);
  }, [percentage]);

  return (
    <div className="relative flex shrink-0 items-center justify-center">
      <svg width="100" height="100" viewBox="0 0 100 100" className="transform -rotate-90">
        <circle cx="50" cy="50" r="45" fill="none" stroke="rgb(var(--color-border))" strokeWidth="3" />
        <circle
          cx="50"
          cy="50"
          r="45"
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          className="transition-all duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold text-text-primary">{Math.round(percentage)}%</span>
        <span className="text-xs font-semibold text-text-muted">Score</span>
      </div>
    </div>
  );
}

function QuestionResult({ question, index, onImageClick }) {
  const [expanded, setExpanded] = useState(false);
  const isMcq = question.question_type === "mcq" || question.type === "mcq";
  const isCode = question.question_type === "coding" || question.type === "coding" || question.type === "code";
  const isCorrect = Number(question.marks_obtained || 0) >= Number(question.max_marks || 0);

  return (
    <div className="rounded-lg border border-border/50 bg-background-elevated/30">
      <button
        type="button"
        className="w-full px-4 py-3 text-left transition hover:bg-background-elevated/50"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {isCorrect ? (
              <CheckCircle2 size={20} className="shrink-0 text-success" />
            ) : (
              <XCircle size={20} className="shrink-0 text-danger" />
            )}
            <div className="min-w-0">
              <p className="font-semibold text-text-primary">Question {index}</p>
              <p className="truncate text-sm text-text-secondary">{question.question_text || question.text}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {Number(question.time_spent_seconds || 0) > 0 && (
              <Badge variant="secondary" size="sm">
                {formatDuration(question.time_spent_seconds)}
              </Badge>
            )}
            <Badge variant={isMcq ? "info" : isCode ? "purple" : "secondary"} size="sm">
              {question.question_type || question.type || "written"}
            </Badge>
            <Badge variant={isCorrect ? "success" : "danger"} size="sm">
              {question.marks_obtained}/{question.max_marks}
            </Badge>
            {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/50 bg-background-base/50 px-4 py-4 space-y-4">
          {/* Question Text */}
          <div>
            <p className="text-xs font-semibold text-text-muted">QUESTION</p>
            {Number(question.time_spent_seconds || 0) > 0 && (
              <p className="mt-1 text-xs font-semibold text-text-muted">
                Time spent: {formatDuration(question.time_spent_seconds)}
              </p>
            )}
            <p className="mt-2 text-text-primary">{question.question_text || question.text}</p>
            {question.image_urls?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-3">
                {question.image_urls.map(url => (
                  <button key={url} type="button" onClick={() => onImageClick(url)} className="rounded-lg border border-border p-1 transition hover:border-brand-primary">
                    <img src={url} alt="" className="h-24 w-32 rounded-md object-cover" />
                  </button>
                ))}
              </div>
            )}
            {question.code_snippet && (
              <pre className="mt-3 max-h-56 overflow-auto rounded-lg bg-slate-950 p-4 font-mono text-sm text-slate-100">
                <span className="mb-2 block text-xs font-semibold uppercase text-slate-400">Read Only Code Block</span>
                {question.code_snippet}
              </pre>
            )}
          </div>

          {isMcq && question.options?.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-text-muted">OPTIONS</p>
              {question.options.map(option => {
                const isStudent = option === question.student_answer;
                const isAnswer = option === question.correct_answer;
                return (
                  <div
                    key={option}
                    className={[
                      "rounded-lg border px-3 py-2 text-sm",
                      isAnswer ? "border-success bg-success/10 text-success" : "",
                      isStudent && !isAnswer ? "border-danger bg-danger/10 text-danger" : "",
                      !isStudent && !isAnswer ? "border-border bg-background-base text-text-secondary" : ""
                    ].join(" ")}
                  >
                    {option}
                    {isStudent && <span className="ml-2 font-semibold">(your answer)</span>}
                    {isAnswer && <span className="ml-2 font-semibold">(correct)</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Model Answer */}
          {question.model_answer && (
            <div className="rounded-lg bg-success/5 p-3">
              <p className="text-xs font-semibold text-success">Model Answer</p>
              <p className="mt-2 text-sm text-text-primary">{question.model_answer}</p>
            </div>
          )}

          {/* Student Answer */}
          <div>
            <p className="text-xs font-semibold text-text-muted">YOUR ANSWER</p>
            {isCode ? (
              <div className="mt-2 overflow-hidden rounded-lg border border-border">
                <Editor
                  height="260px"
                  defaultLanguage={question.code_language || "python"}
                  value={question.student_answer || ""}
                  theme={document.documentElement.classList.contains("dark") ? "vs-dark" : "light"}
                  options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
                />
              </div>
            ) : (
              <blockquote className="mt-2 rounded-lg border-l-4 border-brand-primary bg-background-elevated/50 p-3 text-sm text-text-primary">
                {question.student_answer || "-"}
              </blockquote>
            )}
          </div>

          {/* Teacher Remark */}
          {question.teacher_remark && (
            <div className="flex gap-3 rounded-lg border border-info/30 bg-info/5 p-3">
              <MessageSquare className="mt-0.5 shrink-0 text-info" size={17} />
              <div>
                <p className="text-xs font-semibold text-info">Teacher Remark</p>
                <p className="mt-1 text-sm text-text-secondary">{question.teacher_remark}</p>
              </div>
            </div>
          )}

          {/* Code Question Output */}
          {isCode && question.execution_output && (
            <div className="rounded-lg border border-border/50 bg-background-base/50 p-3">
              <p className="text-xs font-semibold text-text-muted">EXECUTION OUTPUT</p>
              <pre className="mt-2 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
                {question.execution_output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
