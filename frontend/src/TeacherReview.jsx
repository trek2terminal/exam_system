import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Download,
  Eye,
  FileSearch,
  Filter,
  ListChecks,
  Percent,
  Save,
  Search,
  ShieldAlert,
  Users
} from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, MarksInput, Modal, Textarea } from "./components/ui";
import { api } from "./services/api";
import { notify } from "./components/ui/Toast";
import { formatDate } from "./utils/dateFormat";
import { useLiveRefresh } from "./hooks/useLiveRefresh";

function scoreLabel(result) {
  if (!result) return "-";
  return `${result.total_marks_obtained} / ${result.total_marks}`;
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

function reviewStatusVariant(status) {
  if (status === "published") return "success";
  if (status === "evaluated") return "info";
  if (status === "pending") return "warning";
  if (status === "in_progress") return "secondary";
  return "secondary";
}

function priorityVariant(priority) {
  if (priority === "critical") return "danger";
  if (priority === "high") return "warning";
  return "secondary";
}

function humanReviewStatus(status) {
  return String(status || "unknown").replace(/_/g, " ");
}

function questionTypeLabel(type) {
  const normalized = String(type || "short").toLowerCase();
  if (normalized === "mcq") return "MCQ";
  if (normalized === "coding" || normalized === "code") return "Code";
  if (normalized === "long" || normalized === "long_answer") return "Long";
  return "Short";
}

const EMPTY_ARRAY = [];
const EMPTY_OBJECT = {};

export default function TeacherReview({ mode }) {
  if (mode === "session") return <TeacherSessionReview />;
  return <TeacherExamReview />;
}

function TeacherExamReview() {
  const { examId } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [similarityOpen, setSimilarityOpen] = useState(false);
  const [similarityLoading, setSimilarityLoading] = useState(false);
  const [similarityFlags, setSimilarityFlags] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortMode, setSortMode] = useState("priority");

  const loadReview = useCallback(async (soft = false) => {
    if (!soft) setLoading(true);
    setError("");
    try {
      const response = await api.get(`/teacher/exam/${examId}/review`);
      setData(response.data);
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not load review data.");
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    loadReview();
  }, [loadReview]);
  useLiveRefresh(loadReview, { intervalMs: 20000 });

  const publishAll = async publish => {
    setSaving(true);
    setError("");
    try {
      await api.post(`/teacher/exam/${examId}/publish-results`, { publish });
      await loadReview();
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not update published results.");
    } finally {
      setSaving(false);
    }
  };

  const openSimilarity = async () => {
    setSimilarityOpen(true);
    setSimilarityLoading(true);
    try {
      const response = await api.get(`/teacher/exam/${examId}/similarity`);
      setSimilarityFlags(response.data.flags || []);
    } catch (err) {
      notify.error(err.message || "Could not load similarity report.");
    } finally {
      setSimilarityLoading(false);
    }
  };

  const stats = data?.stats || EMPTY_OBJECT;
  const sessions = data?.sessions || EMPTY_ARRAY;
  const visibleSessions = useMemo(() => {
    const priorityWeight = { critical: 0, high: 1, normal: 2, complete: 3 };
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return sessions
      .filter(item => {
        const matchesSearch = !normalizedSearch
          || `${item.student_name || ""} ${item.roll_no || ""} ${item.session_code || ""}`.toLowerCase().includes(normalizedSearch);
        if (!matchesSearch) return false;
        if (statusFilter === "all") return true;
        if (statusFilter === "flagged") return item.review_priority === "high" || item.review_priority === "critical" || Number(item.focus_violations || 0) > 0;
        return item.review_status === statusFilter;
      })
      .sort((left, right) => {
        if (sortMode === "name") return String(left.student_name || "").localeCompare(String(right.student_name || ""));
        if (sortMode === "score") return Number(right.result?.percentage || -1) - Number(left.result?.percentage || -1);
        if (sortMode === "recent") return String(right.submitted_at || right.started_at || "").localeCompare(String(left.submitted_at || left.started_at || ""));
        return (priorityWeight[left.review_priority] ?? 9) - (priorityWeight[right.review_priority] ?? 9)
          || String(right.submitted_at || right.started_at || "").localeCompare(String(left.submitted_at || left.started_at || ""));
      });
  }, [searchTerm, sessions, sortMode, statusFilter]);

  if (loading) return <div className="loadingScreen">Loading review workspace...</div>;
  if (error) return <ErrorPanel message={error} backHref="/react/teacher" />;

  return (
    <section className="teacherReviewWorkspace">
      <Card className="reviewHeader">
        <div>
          <span className="eyebrow">Teacher review</span>
          <h2>{data.exam.exam_name}</h2>
          <p>{data.exam.subject} | Set {data.exam.set_code} | Access {data.exam.access_code}</p>
        </div>
        <div className="actionRow">
          <Button variant="secondary" size="sm" as="a" href={data.links.csv_export}><Download size={18} /> CSV</Button>
          <Button variant="secondary" size="sm" onClick={openSimilarity}><FileSearch size={18} /> Similarity</Button>
          <Button variant="primary" size="sm" disabled={saving || stats.evaluated === 0} onClick={() => publishAll(true)}>
            <CheckCircle2 size={18} /> Publish evaluated
          </Button>
          <Button variant="secondary" size="sm" disabled={saving || stats.published === 0} onClick={() => publishAll(false)}>
            Hide published
          </Button>
        </div>
      </Card>

      <section className="studentStats">
        <Card className="p-4">
          <Users size={18} />
          <span>Attempts</span>
          <strong>{stats.attempts || 0}</strong>
        </Card>
        <Card className="p-4">
          <CheckCircle2 size={18} />
          <span>Pending</span>
          <strong>{stats.pending_review || 0}</strong>
        </Card>
        <Card className="p-4">
          <Save size={18} />
          <span>Evaluated</span>
          <strong>{stats.evaluated || 0}</strong>
        </Card>
        <Card className="p-4">
          <Eye size={18} />
          <span>Published</span>
          <strong>{stats.published || 0}</strong>
        </Card>
        <Card className="p-4">
          <ShieldAlert size={18} />
          <span>Flagged</span>
          <strong>{stats.flagged || 0}</strong>
        </Card>
        <Card className="p-4">
          <Percent size={18} />
          <span>Avg Score</span>
          <strong>{stats.average_score || 0}%</strong>
        </Card>
      </section>

      <Card className="reviewFilters">
        <label>
          <span><Search size={15} /> Search</span>
          <input
            type="search"
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
            placeholder="Name, roll, session"
          />
        </label>
        <label>
          <span><Filter size={15} /> Status</span>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
            <option value="all">All attempts</option>
            <option value="pending">Pending review</option>
            <option value="evaluated">Evaluated</option>
            <option value="published">Published</option>
            <option value="flagged">Flagged</option>
            <option value="in_progress">In progress</option>
          </select>
        </label>
        <label>
          <span><ListChecks size={15} /> Sort</span>
          <select value={sortMode} onChange={event => setSortMode(event.target.value)}>
            <option value="priority">Priority first</option>
            <option value="recent">Recent submission</option>
            <option value="name">Student name</option>
            <option value="score">Highest score</option>
          </select>
        </label>
        <div className="reviewFilterCount">
          <strong>{visibleSessions.length}</strong>
          <span>shown</span>
        </div>
      </Card>

      <section className="reviewTable">
        <div className="reviewTableHead">
          <span>Student</span>
          <span>Review</span>
          <span>Progress</span>
          <span>Score</span>
          <span>Integrity</span>
          <span>Action</span>
        </div>
        {visibleSessions.map(item => (
          <Card key={item.id} className="reviewRow">
            <div>
              <strong>{item.student_name}</strong>
              <p>Roll {item.roll_no} | Submitted {formatDate(item.submitted_at || item.started_at)}</p>
            </div>
            <div className="reviewStatusStack">
              <Badge variant={reviewStatusVariant(item.review_status)} size="sm">{humanReviewStatus(item.review_status)}</Badge>
              {item.review_priority !== "complete" && (
                <Badge variant={priorityVariant(item.review_priority)} size="sm">{item.review_priority}</Badge>
              )}
            </div>
            <div className="reviewProgressCell">
              <strong>{item.answered_count || 0}/{item.total_questions || 0}</strong>
              <span>{item.progress_percent || 0}% answered · {formatDuration(item.time_spent_seconds || 0)}</span>
              <div className="reviewProgressTrack"><i style={{ width: `${Math.max(0, Math.min(Number(item.progress_percent || 0), 100))}%` }} /></div>
            </div>
            <strong>{scoreLabel(item.result)}</strong>
            <div className="reviewStatusStack">
              <Badge variant={Number(item.focus_violations || 0) > 0 || Number(item.suspicion_score || 0) >= 75 ? "warning" : "success"} size="sm">
                {item.focus_violations || 0} warnings
              </Badge>
              {item.autosubmit_reason && <span className="reviewTinyText">{item.autosubmit_reason}</span>}
            </div>
            <div className="actionRow">
              <Button variant={item.review_status === "pending" ? "primary" : "secondary"} size="sm" as={Link} to={`/teacher/session/${item.id}/review`}>
                {item.review_status === "pending" ? "Mark" : "Open"}
              </Button>
              <Button variant="ghost" size="sm" as="a" href={item.links.answer_pdf}>PDF</Button>
            </div>
          </Card>
        ))}
        {!visibleSessions.length && (
          <EmptyState
            icon={Users}
            heading={sessions.length ? "No matching submissions" : "No student attempts yet"}
            description={sessions.length ? "Adjust the search or filters to view more submissions." : "Submissions will appear here after students enter this exam."}
            className="rounded-card border border-border bg-background-surface"
          />
        )}
      </section>

      <Modal open={similarityOpen} onClose={() => setSimilarityOpen(false)} title="Similarity Report" className="max-w-4xl">
        {similarityLoading ? (
          <Card className="p-5 text-center text-text-muted">Checking submissions...</Card>
        ) : similarityFlags.length > 0 ? (
          <div className="max-h-[70vh] overflow-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-background-surface text-text-secondary">
                <tr>
                  <th className="px-3 py-2">Question</th>
                  <th className="px-3 py-2">Student A</th>
                  <th className="px-3 py-2">Student B</th>
                  <th className="px-3 py-2">Similarity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {similarityFlags.map((flag, index) => (
                  <tr key={`${flag.question_id}-${flag.student_a?.session_id}-${flag.student_b?.session_id}-${index}`}>
                    <td className="px-3 py-2 text-text-primary">
                      <p className="line-clamp-2">{flag.question_text}</p>
                      <Badge variant="purple" size="sm">{flag.question_type}</Badge>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{flag.student_a?.name} ({flag.student_a?.roll_no})</td>
                    <td className="px-3 py-2 text-text-secondary">{flag.student_b?.name} ({flag.student_b?.roll_no})</td>
                    <td className="px-3 py-2"><Badge variant="warning">{flag.score}%</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Card className="p-6 text-center text-text-muted">No high-similarity answer pairs found.</Card>
        )}
      </Modal>
    </section>
  );
}

function TeacherSessionReview() {
  const { sessionId } = useParams();
  const [data, setData] = useState(null);
  const [marks, setMarks] = useState({});
  const [remarks, setRemarks] = useState({});
  const [teacherRemarks, setTeacherRemarks] = useState("");
  const [published, setPublished] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [questionFilter, setQuestionFilter] = useState("all");
  const [touchedMarks, setTouchedMarks] = useState({});

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/teacher/session/${sessionId}/review`);
      setData(response.data);
      const nextMarks = {};
      const nextRemarks = {};
      response.data.questions.forEach(question => {
        const suggested = question.mark?.suggested_marks;
        nextMarks[question.id] = question.mark?.has_saved_mark
          ? question.mark?.marks_awarded ?? 0
          : suggested !== null && suggested !== undefined
            ? suggested
            : 0;
        nextRemarks[question.id] = question.mark?.teacher_remark || "";
      });
      setMarks(nextMarks);
      setRemarks(nextRemarks);
      setTouchedMarks({});
      setTeacherRemarks(response.data.teacher_remarks || "");
      setPublished(Boolean(response.data.published));
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not load this submission.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const totalAwarded = useMemo(() => (
    Object.values(marks).reduce((sum, value) => sum + Number(value || 0), 0)
  ), [marks]);
  const reviewStats = useMemo(() => {
    const questions = data?.questions || [];
    const readyCount = questions.filter(question => (
      question.mark?.has_saved_mark
      || touchedMarks[question.id]
      || question.mark?.mark_status === "suggested"
      || question.mark?.mark_status === "no_answer"
    )).length;
    const needsManualCount = questions.filter(question => question.mark?.needs_manual_review).length;
    const answeredCount = questions.filter(question => question.answer?.answered).length;
    return {
      total: questions.length,
      readyCount,
      needsManualCount,
      answeredCount,
      progress: questions.length ? Math.round((readyCount / questions.length) * 100) : 0,
    };
  }, [data?.questions, touchedMarks]);
  const visibleQuestions = useMemo(() => {
    const questions = data?.questions || [];
    return questions.filter(question => {
      if (questionFilter === "manual") return question.mark?.needs_manual_review;
      if (questionFilter === "unanswered") return !question.answer?.answered;
      if (questionFilter === "flagged") return Number(question.answer?.visit_count || 0) > 1 || question.answer?.visit_status === "ANSWERED_MARKED" || question.answer?.visit_status === "MARKED_REVIEW";
      if (questionFilter === "unmarked") return !question.mark?.has_saved_mark && question.mark?.mark_status !== "suggested" && question.mark?.mark_status !== "no_answer" && !touchedMarks[question.id];
      return true;
    });
  }, [data?.questions, questionFilter, touchedMarks]);

  const setQuestionMark = (questionId, value) => {
    setMarks(current => ({ ...current, [questionId]: value }));
    setTouchedMarks(current => ({ ...current, [questionId]: true }));
  };

  const applySuggestions = () => {
    if (!data?.questions?.length) return;
    const nextMarks = {};
    const nextTouched = {};
    data.questions.forEach(question => {
      const suggested = question.mark?.suggested_marks;
      if (suggested !== null && suggested !== undefined) {
        nextMarks[question.id] = suggested;
        nextTouched[question.id] = true;
      }
    });
    setMarks(current => ({ ...current, ...nextMarks }));
    setTouchedMarks(current => ({ ...current, ...nextTouched }));
  };

  const saveReview = async () => {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const payload = {
        teacher_remarks: teacherRemarks,
        published,
        marks: data.questions.map(question => ({
          question_id: question.id,
          marks_awarded: Number(marks[question.id] || 0),
          teacher_remark: remarks[question.id] || ""
        }))
      };
      const response = await api.post(`/teacher/session/${sessionId}/review`, payload);
      setData(response.data);
      setTouchedMarks({});
      setMessage("Marks saved successfully.");
    } catch (err) {
      setError(err.response?.data?.message || err.message || "Could not save marks.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="loadingScreen">Loading student answers...</div>;
  if (error && !data) return <ErrorPanel message={error} backHref="/react/teacher" />;

  const locked = Boolean(data.locked_for_review);

  return (
    <section className="teacherMarkWorkspace">
      <Card className="reviewHeader">
        <div>
          <Button variant="ghost" size="sm" as={Link} to={`/teacher/exam/${data.exam.id}/review`}>
            <ArrowLeft size={16} /> Back to exam
          </Button>
          <span className="eyebrow">Mark submission</span>
          <h2>{data.student_session.student_name}</h2>
          <p>Roll {data.student_session.roll_no} | {data.exam.exam_name}</p>
        </div>
        <div className="reviewScoreBox">
          <span>Total</span>
          <strong>{totalAwarded} / {data.questions.reduce((sum, question) => sum + question.marks, 0)}</strong>
        </div>
      </Card>

      {error && <div className="alert">{error}</div>}
      {message && <div className="successBanner">{message}</div>}
      {!locked && (
        <div className="alert">This attempt is still in progress. Marks can be saved after submission.</div>
      )}

      <div className="teacherMarkLayout">
        <aside className="reviewAssistantPanel">
          <div>
            <span className="eyebrow">Marking progress</span>
            <strong>{reviewStats.readyCount} / {reviewStats.total}</strong>
            <div className="reviewProgressTrack"><i style={{ width: `${reviewStats.progress}%` }} /></div>
            <p>{reviewStats.answeredCount} answered · {reviewStats.needsManualCount} needs manual review</p>
          </div>
          <div className="reviewQuickStats">
            <span><Clock3 size={15} /> {formatDuration(data.student_session.time_spent_seconds || 0)}</span>
            <span><AlertTriangle size={15} /> {data.student_session.focus_violations || 0} warnings</span>
            <span><BarChart3 size={15} /> {data.student_session.progress_percent || 0}% attempted</span>
          </div>
          <div className="questionFilterPills">
            {[
              ["all", "All"],
              ["manual", "Manual"],
              ["unmarked", "Unmarked"],
              ["unanswered", "Blank"],
              ["flagged", "Review"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={questionFilter === value ? "active" : ""}
                onClick={() => setQuestionFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <Button variant="secondary" size="sm" onClick={applySuggestions} disabled={!locked}>
            <ClipboardCheck size={16} /> Apply suggestions
          </Button>
          <Textarea
            label="Teacher summary remarks"
            value={teacherRemarks}
            onChange={event => setTeacherRemarks(event.target.value)}
            rows={5}
          />
          <label className="checkboxLine">
            <input type="checkbox" checked={published} onChange={event => setPublished(event.target.checked)} />
            Publish result after saving
          </label>
        </aside>

        <section className="teacherQuestionReviewList">
          {visibleQuestions.map(question => (
            <article className="teacherQuestionReview" key={question.id}>
              <div className="questionCardHead">
                <div>
                  <span className="questionNumber">Q{question.question_number}</span>
                  <h3>{question.question_text}</h3>
                  <p>
                    {questionTypeLabel(question.question_type)} · Max {question.marks} mark{question.marks === 1 ? "" : "s"}
                    {Number(question.answer?.time_spent_seconds || 0) > 0 ? ` · Time spent ${formatDuration(question.answer.time_spent_seconds)}` : ""}
                    {Number(question.answer?.visit_count || 0) > 0 ? ` · ${question.answer.visit_count} visit${question.answer.visit_count === 1 ? "" : "s"}` : ""}
                  </p>
                </div>
                <div className="reviewStatusStack">
                  <Badge variant={question.mark?.needs_manual_review ? "warning" : question.mark?.is_auto_gradable ? "info" : "secondary"} size="sm">
                    {question.mark?.mark_status || "unmarked"}
                  </Badge>
                  {question.mark?.suggested_marks !== null && question.mark?.suggested_marks !== undefined && (
                    <Badge variant="purple" size="sm">suggested {question.mark.suggested_marks}</Badge>
                  )}
                </div>
              </div>

              {question.image_urls?.length > 0 && (
                <div className="questionImages">
                  {question.image_urls.map(url => (
                    <a href={url} key={url} target="_blank" rel="noreferrer"><img src={url} alt={`Q${question.question_number}`} /></a>
                  ))}
                </div>
              )}

              {question.code_snippet && <pre className="questionCodeSnippet"><code>{question.code_snippet}</code></pre>}
              {question.model_answer && (
                <div className="answerReviewBox model">
                  <strong>Model answer</strong>
                  <p>{question.model_answer}</p>
                </div>
              )}

              <div className="answerReviewBox">
                <strong>Student answer</strong>
                <pre>{question.answer?.answer_text || "No answer submitted."}</pre>
              </div>

              {(question.question_type === "coding" || question.question_type === "code") && question.answer?.code_output && (
                <div className="answerReviewBox">
                  <strong>Last code output</strong>
                  <pre>{question.answer.code_output}</pre>
                </div>
              )}

              <div className="rubricBar">
                {question.mark?.rubric?.map(item => (
                  <button
                    key={`${question.id}-${item.label}`}
                    type="button"
                    disabled={!locked}
                    onClick={() => setQuestionMark(question.id, item.marks)}
                  >
                    <strong>{item.label}</strong>
                    <span>{item.marks} marks</span>
                  </button>
                ))}
                {question.mark?.suggested_marks !== null && question.mark?.suggested_marks !== undefined && (
                  <button type="button" disabled={!locked} onClick={() => setQuestionMark(question.id, question.mark.suggested_marks)}>
                    <strong>Suggestion</strong>
                    <span>{question.mark.suggested_marks} marks</span>
                  </button>
                )}
              </div>

              <div className="markGrid">
                <MarksInput
                  label="Marks awarded"
                  min="0"
                  max={question.marks}
                  step="0.01"
                  value={marks[question.id] ?? 0}
                  onChange={event => setQuestionMark(question.id, event.target.value)}
                  disabled={!locked}
                  className="!p-2"
                  required
                />
                <Input
                  label="Remark"
                  type="text"
                  value={remarks[question.id] || ""}
                  onChange={event => setRemarks(current => ({ ...current, [question.id]: event.target.value }))}
                  disabled={!locked}
                  className="!p-2"
                />
              </div>
            </article>
          ))}
          {!visibleQuestions.length && (
            <EmptyState
              icon={ListChecks}
              heading="No questions in this view"
              description="Change the question filter to continue marking."
              className="rounded-card border border-border bg-background-surface"
            />
          )}
        </section>
      </div>

      <div className="stickySaveBar">
        <Button variant="secondary" size="sm" as="a" href={data.links.answer_pdf}><Download size={18} /> Answer PDF</Button>
        <Button variant="primary" size="sm" disabled={!locked || saving} onClick={saveReview}>
          <Save size={18} /> {saving ? "Saving..." : "Save marks"}
        </Button>
      </div>
    </section>
  );
}

function ErrorPanel({ message, backHref }) {
  return (
    <section className="emptyState">
      <ShieldAlert size={36} />
      <h2>Review cannot open</h2>
      <p>{message}</p>
      <Button as="a" variant="primary" size="sm" href={backHref}>Back</Button>
    </section>
  );
}
