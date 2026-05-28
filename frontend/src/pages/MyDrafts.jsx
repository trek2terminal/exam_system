import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpenCheck, ClipboardList, FileText, RefreshCw, Trash2, UserRoundCog } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, Card, EmptyState, PageLoading } from "../components/ui";
import { notify } from "../components/ui/Toast";
import { api, cachedGet } from "../services/api";
import { formatDate, timeAgo } from "../utils/dateFormat";

const typeMeta = {
  exam: { label: "Exam Draft", icon: BookOpenCheck, path: "/teacher/exam/new" },
  question_bank: { label: "Question Draft", icon: ClipboardList, path: "/teacher/question-bank" },
  admin_group: { label: "Group Draft", icon: UserRoundCog, path: "/admin/groups" },
  admin_teacher: { label: "Teacher Account Draft", icon: FileText, path: "/admin/users" },
  admin_settings: { label: "Settings Draft", icon: FileText, path: "/admin/settings" }
};

function metaForDraft(draft) {
  const type = draft.draft_type || "";
  if (type.startsWith("exam_edit_")) {
    const examId = type.replace("exam_edit_", "");
    return { label: "Exam Edit Draft", icon: BookOpenCheck, path: `/teacher/exam/${examId}/edit` };
  }
  if (type.startsWith("question_bank_edit_")) {
    return { label: "Question Edit Draft", icon: ClipboardList, path: "/teacher/question-bank" };
  }
  return typeMeta[type] || { label: `${type.replaceAll("_", " ")} Draft`, icon: FileText, path: "/" };
}

export default function MyDrafts({ role }) {
  const navigate = useNavigate();
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await cachedGet("/drafts", { cacheTtl: 5000 });
      setDrafts(data.drafts || []);
    } catch (error) {
      notify.error(error.message || "Could not load drafts");
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  const visibleDrafts = useMemo(() => drafts.filter(draft => {
    if (role === "admin") return draft.user_role === "admin";
    if (role === "teacher") return draft.user_role === "teacher";
    return false;
  }), [drafts, role]);

  const continueDraft = draft => {
    const meta = metaForDraft(draft);
    navigate(`${meta.path}?draft=${draft.id}`);
  };

  const deleteDraft = async draft => {
    if (!window.confirm("Are you sure you want to delete this draft? This cannot be undone.")) return;
    setDeletingId(draft.id);
    try {
      await api.delete(`/drafts/${draft.id}`);
      setDrafts(current => current.filter(item => item.id !== draft.id));
      window.localStorage.removeItem(`examSystem:draft:${draft.draft_type}`);
      notify.success("Draft deleted");
    } catch (error) {
      notify.error(error.message || "Could not delete draft");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">{role === "admin" ? "Admin" : "Teacher"} workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">My Drafts</h1>
          <p className="mt-1 text-text-secondary">Resume unfinished work saved automatically from your creation forms.</p>
        </div>
        <Button type="button" variant="secondary" onClick={loadDrafts} loading={loading} loadingLabel="Refreshing">
          <RefreshCw size={16} /> Refresh
        </Button>
      </div>

      {loading ? (
        <PageLoading title="Loading drafts..." />
      ) : visibleDrafts.length === 0 ? (
        <EmptyState
          icon={FileText}
          heading="No drafts yet"
          description="Start creating something and your progress will be saved automatically."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleDrafts.map(draft => {
            const meta = metaForDraft(draft);
            const Icon = meta.icon;
            return (
              <Card key={draft.id} className="p-5">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
                    <Icon size={21} />
                  </span>
                  <Badge variant="secondary">{meta.label}</Badge>
                </div>
                <h2 className="line-clamp-2 text-lg font-semibold text-text-primary">
                  {draft.title_preview || `Untitled ${meta.label}`}
                </h2>
                <p className="mt-2 text-sm text-text-secondary">
                  Last edited {timeAgo(draft.updated_at) || formatDate(draft.updated_at)}
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="primary" onClick={() => continueDraft(draft)}>
                    Continue editing
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-danger hover:text-danger"
                    loading={deletingId === draft.id}
                    loadingLabel="Deleting"
                    onClick={() => deleteDraft(draft)}
                  >
                    <Trash2 size={16} /> Delete
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
