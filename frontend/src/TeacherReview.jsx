import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  FileSearch,
  Save,
  ShieldAlert,
  Users
} from "lucide-react";
import { api } from "./services/api";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function scoreLabel(result) {
  if (!result) return "-";
  return `${result.total_marks_obtained} / ${result.total_marks}`;
}

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

  const loadReview = useCallback(async () => {
    setLoading(true);
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

  if (loading) return <div className="loadingScreen">Loading review workspace...</div>;
  if (error) return <ErrorPanel message={error} backHref="/react/teacher" />;

  const stats = data?.stats || {};
  const sessions = data?.sessions || [];

  return (
    <section className="teacherReviewWorkspace">
      <div className="reviewHeader">
        <div>
          <span className="eyebrow">Teacher review</span>
          <h2>{data.exam.exam_name}</h2>
          <p>{data.exam.subject} | Set {data.exam.set_code} | Access {data.exam.access_code}</p>
        </div>
        <div className="actionRow">
          <a className="button secondary" href={data.links.csv_export}><Download size={18} /> CSV</a>
          <a className="button secondary" href={data.links.similarity}><FileSearch size={18} /> Similarity</a>
          <button className="button primary" type="button" disabled={saving || stats.evaluated === 0} onClick={() => publishAll(true)}>
            <CheckCircle2 size={18} /> Publish evaluated
          </button>
          <button className="button secondary" type="button" disabled={saving || stats.published === 0} onClick={() => publishAll(false)}>
            Hide published
          </button>
        </div>
      </div>

      <section className="studentStats">
        <article><Users size={18} /><span>Attempts</span><strong>{stats.attempts || 0}</strong></article>
        <article><CheckCircle2 size={18} /><span>Submitted</span><strong>{stats.submitted || 0}</strong></article>
        <article><Save size={18} /><span>Evaluated</span><strong>{stats.evaluated || 0}</strong></article>
        <article><Eye size={18} /><span>Published</span><strong>{stats.published || 0}</strong></article>
      </section>

      <section className="reviewTable">
        <div className="reviewTableHead">
          <span>Student</span>
          <span>Status</span>
          <span>Score</span>
          <span>Published</span>
          <span>Violations</span>
          <span>Action</span>
        </div>
        {sessions.map(item => (
          <article className="reviewRow" key={item.id}>
            <div>
              <strong>{item.student_name}</strong>
              <p>Roll {item.roll_no} | Started {formatDate(item.started_at)}</p>
            </div>
            <span className={`status ${item.status}`}>{item.status}</span>
            <strong>{scoreLabel(item.result)}</strong>
            <span className={`status ${item.result?.published ? "active" : "draft"}`}>
              {item.result?.published ? "published" : item.result ? "hidden" : "not marked"}
            </span>
            <strong>{item.focus_violations}</strong>
            <div className="actionRow">
              <Link className="button primary" to={`/teacher/session/${item.id}/review`}>Mark</Link>
              <a className="button quiet" href={item.links.answer_pdf}>PDF</a>
            </div>
          </article>
        ))}
        {!sessions.length && (
          <div className="emptyState">
            <Users size={34} />
            <h3>No student attempts yet</h3>
            <p>Submissions will appear here after students enter this exam.</p>
          </div>
        )}
      </section>
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

  const loadSession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get(`/teacher/session/${sessionId}/review`);
      setData(response.data);
      const nextMarks = {};
      const nextRemarks = {};
      response.data.questions.forEach(question => {
        nextMarks[question.id] = question.mark?.marks_awarded ?? 0;
        nextRemarks[question.id] = question.mark?.teacher_remark || "";
      });
      setMarks(nextMarks);
      setRemarks(nextRemarks);
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
      <div className="reviewHeader">
        <div>
          <Link className="backLink" to={`/teacher/exam/${data.exam.id}/review`}><ArrowLeft size={16} /> Back to exam</Link>
          <span className="eyebrow">Mark submission</span>
          <h2>{data.student_session.student_name}</h2>
          <p>Roll {data.student_session.roll_no} | {data.exam.exam_name}</p>
        </div>
        <div className="reviewScoreBox">
          <span>Total</span>
          <strong>{totalAwarded} / {data.questions.reduce((sum, question) => sum + question.marks, 0)}</strong>
        </div>
      </div>

      {error && <div className="alert">{error}</div>}
      {message && <div className="successBanner">{message}</div>}
      {!locked && (
        <div className="alert">This attempt is still in progress. Marks can be saved after submission.</div>
      )}

      <section className="teacherSummaryBox">
        <label>Teacher summary remarks</label>
        <textarea value={teacherRemarks} onChange={event => setTeacherRemarks(event.target.value)} rows={4} />
        <label className="checkboxLine">
          <input type="checkbox" checked={published} onChange={event => setPublished(event.target.checked)} />
          Publish result to student after saving
        </label>
      </section>

      <section className="teacherQuestionReviewList">
        {data.questions.map(question => (
          <article className="teacherQuestionReview" key={question.id}>
            <div className="questionCardHead">
              <div>
                <span className="questionNumber">Q{question.question_number}</span>
                <h3>{question.question_text}</h3>
                <p>{question.question_type} | Max {question.marks} mark{question.marks === 1 ? "" : "s"}</p>
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

            {question.question_type === "coding" && question.answer?.code_output && (
              <div className="answerReviewBox">
                <strong>Last code output</strong>
                <pre>{question.answer.code_output}</pre>
              </div>
            )}

            <div className="markGrid">
              <label>
                Marks awarded
                <input
                  type="number"
                  min="0"
                  max={question.marks}
                  value={marks[question.id] ?? 0}
                  onChange={event => setMarks(current => ({ ...current, [question.id]: event.target.value }))}
                  disabled={!locked}
                />
              </label>
              <label>
                Remark
                <input
                  type="text"
                  value={remarks[question.id] || ""}
                  onChange={event => setRemarks(current => ({ ...current, [question.id]: event.target.value }))}
                  disabled={!locked}
                />
              </label>
            </div>
          </article>
        ))}
      </section>

      <div className="stickySaveBar">
        <a className="button secondary" href={data.links.answer_pdf}><Download size={18} /> Answer PDF</a>
        <a className="button quiet" href={data.links.flask_review}>Classic view</a>
        <button className="button primary" type="button" disabled={!locked || saving} onClick={saveReview}>
          <Save size={18} /> {saving ? "Saving..." : "Save marks"}
        </button>
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
      <a className="button primary" href={backHref}>Back</a>
    </section>
  );
}
