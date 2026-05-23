import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Download, CheckCircle2, XCircle, FileText } from "lucide-react";
import { Badge, Button, Card, Skeleton } from "../components/ui";
import { api } from "../services/api";

export default function StudentResults() {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedQuestion, setExpandedQuestion] = useState(null);

  useEffect(() => {
    const loadResults = async () => {
      try {
        const { data } = await api.get("/student/dashboard");
        const resultCards = (data.exams || [])
          .filter(exam => exam.result)
          .map(exam => ({
            id: exam.latest_session?.id || exam.exam_id,
            exam_name: exam.exam_name,
            submitted_at: exam.result.published_at || exam.latest_session?.submitted_at || exam.end_time,
            total_marks_obtained: exam.result.total_marks_obtained,
            total_marks: exam.result.total_marks,
            percentage: exam.result.percentage,
            passing_percentage: exam.passing_percentage || 40,
            time_taken: exam.result.time_taken,
            pdf_url: exam.result.pdf_href,
            questions: exam.result.questions || []
          }));
        setResults(resultCards);
      } catch (error) {
        console.error("Failed to load results:", error);
      } finally {
        setLoading(false);
      }
    };
    loadResults();
  }, []);

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
          />
        ))}
      </div>
    </div>
  );
}

function ResultCard({ result, expanded, onToggle }) {
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
            {result.submitted_at ? `Submitted on ${new Date(result.submitted_at).toLocaleDateString()}` : "Submission date unavailable"}
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
                variant={result.percentage >= result.passing_percentage ? "success" : "danger"}
                className="mt-1"
              >
                {result.percentage >= result.passing_percentage ? "PASSED" : "FAILED"}
              </Badge>
            </div>
            <div>
              <p className="text-xs font-semibold text-text-muted">DURATION</p>
              <p className="text-lg font-bold text-text-primary">{result.time_taken ? `${result.time_taken} min` : "-"}</p>
            </div>
          </div>

          {/* Questions Breakdown */}
          <div className="border-t border-border/50 pt-4">
            <h4 className="mb-4 font-semibold text-text-primary">Question Breakdown</h4>
            <div className="space-y-3">
              {result.questions?.map((question, index) => (
                <QuestionResult key={index} question={question} index={index + 1} />
              ))}
            </div>
          </div>

          {/* Download PDF */}
          {result.pdf_url && (
            <div className="border-t border-border/50 pt-4">
              <Button as="a" href={result.pdf_url} download variant="primary" size="sm">
                <Download size={16} /> Download PDF Report
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function ScoreDisplay({ result }) {
  const percentage = result.percentage || 0;
  const circumference = 2 * Math.PI * 45;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;
  const color = percentage >= (result.passing_percentage || 40) ? "rgb(var(--color-success))" : "rgb(var(--color-danger))";

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

function QuestionResult({ question, index }) {
  const [expanded, setExpanded] = useState(false);
  const isCorrect = question.marks_obtained === question.max_marks;

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
              <p className="truncate text-sm text-text-secondary">{question.text}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-3">
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
            <p className="mt-2 text-text-primary">{question.text}</p>
          </div>

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
            <p className="mt-2 text-sm text-text-primary">{question.student_answer || "-"}</p>
          </div>

          {/* Teacher Remark */}
          {question.teacher_remark && (
            <div className="rounded-lg border border-border/50 bg-background-elevated/30 p-3">
              <p className="text-xs font-semibold text-text-muted">Teacher Remark</p>
              <p className="mt-1 text-sm text-text-secondary">{question.teacher_remark}</p>
            </div>
          )}

          {/* Code Question Output */}
          {question.type === "code" && question.execution_output && (
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
