import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { Button } from "../components/ui";
import { api } from "../services/api";
import { timeAgo } from "../utils/dateFormat";

const SAVE_DELAY_MS = 2500;
const RETRY_DELAY_MS = 30000;

function cacheKey(draftType) {
  return `examSystem:draft:${draftType}`;
}

function isEmptyValue(value) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0 || value.every(isEmptyValue);
  if (typeof value === "object") return Object.values(value).every(isEmptyValue);
  return false;
}

function sanitizeDraftData(value) {
  if (typeof File !== "undefined" && value instanceof File) return undefined;
  if (typeof Blob !== "undefined" && value instanceof Blob) return undefined;
  if (typeof FileList !== "undefined" && value instanceof FileList) return undefined;
  if (Array.isArray(value)) {
    return value.map(sanitizeDraftData).filter(item => item !== undefined);
  }
  if (value && typeof value === "object") {
    const cleaned = {};
    Object.entries(value).forEach(([key, item]) => {
      // File inputs cannot be serialized or rehydrated, so draft data intentionally skips them.
      if (/file/i.test(key) && (
        (typeof File !== "undefined" && item instanceof File)
        || (typeof Blob !== "undefined" && item instanceof Blob)
        || (typeof FileList !== "undefined" && item instanceof FileList)
        || Array.isArray(item)
      )) return;
      const next = sanitizeDraftData(item);
      if (next !== undefined) cleaned[key] = next;
    });
    return cleaned;
  }
  return value;
}

function readCache(draftType) {
  try {
    return JSON.parse(window.localStorage.getItem(cacheKey(draftType)) || "null");
  } catch {
    return null;
  }
}

function writeCache(draftType, draft) {
  if (!draftType || !draft) return;
  window.localStorage.setItem(cacheKey(draftType), JSON.stringify({
    draftId: draft.id,
    updatedAt: draft.updated_at,
    data: draft.draft_data
  }));
}

function clearCache(draftType) {
  if (draftType) window.localStorage.removeItem(cacheKey(draftType));
}

export function useDraftAutoSave({
  draftType,
  formState,
  onRestore,
  enabled = true,
  dirty = true,
  titlePreview,
  skipIfEmpty = true
}) {
  const [draft, setDraft] = useState(null);
  const [bannerDraft, setBannerDraft] = useState(null);
  const [status, setStatus] = useState("idle");
  const [statusText, setStatusText] = useState("");
  const [lastError, setLastError] = useState(null);
  const restoredRef = useRef(false);
  const initializedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const hideStatusTimerRef = useRef(null);
  const latestDataRef = useRef({});
  const latestTitleRef = useRef("");

  const sanitizedState = useMemo(() => sanitizeDraftData(formState || {}), [formState]);
  const serializedState = useMemo(() => JSON.stringify(sanitizedState || {}), [sanitizedState]);

  const showTransientStatus = useCallback((nextStatus, text) => {
    setStatus(nextStatus);
    setStatusText(text);
    if (hideStatusTimerRef.current) window.clearTimeout(hideStatusTimerRef.current);
    if (nextStatus === "saved") {
      hideStatusTimerRef.current = window.setTimeout(() => {
        setStatus("idle");
        setStatusText("");
      }, 2000);
    }
  }, []);

  const saveDraft = useCallback(async (explicitData) => {
    if (!enabled || !draftType) return null;
    const dataToSave = explicitData || latestDataRef.current || {};
    if (skipIfEmpty && isEmptyValue(dataToSave)) return null;

    showTransientStatus("saving", "Saving draft...");
    try {
      const payload = { draft_type: draftType, draft_data: dataToSave, title_preview: latestTitleRef.current };
      const response = draft?.id
        ? await api.put(`/drafts/${draft.id}`, payload)
        : await api.post("/drafts", payload);
      const savedDraft = response.data?.draft;
      setDraft(savedDraft);
      writeCache(draftType, savedDraft);
      setLastError(null);
      showTransientStatus("saved", "Draft saved");
      return savedDraft;
    } catch (error) {
      setLastError(error);
      window.localStorage.setItem(cacheKey(draftType), JSON.stringify({
        draftId: draft?.id || null,
        updatedAt: new Date().toISOString(),
        data: dataToSave,
        pending: true
      }));
      showTransientStatus("error", "Could not save draft");
      return null;
    }
  }, [draft?.id, draftType, enabled, showTransientStatus, skipIfEmpty]);

  useEffect(() => {
    if (!draftType || !enabled) return undefined;
    let active = true;

    async function loadExistingDraft() {
      const cached = readCache(draftType);
      try {
        let existing = null;
        if (cached?.draftId) {
          const { data } = await api.get(`/drafts/${cached.draftId}`);
          existing = data.draft;
        } else {
          const { data } = await api.get("/drafts", { params: { draft_type: draftType } });
          existing = data.drafts?.[0] || null;
        }
        if (!active) return;
        if (existing) {
          setDraft(existing);
          setBannerDraft(existing);
          writeCache(draftType, existing);
        } else if (cached?.pending && cached.data) {
          setBannerDraft({
            id: cached.draftId,
            draft_type: draftType,
            draft_data: cached.data,
            updated_at: cached.updatedAt
          });
        } else {
          clearCache(draftType);
        }
      } catch {
        if (!active) return;
        if (cached?.data) {
          setBannerDraft({
            id: cached.draftId,
            draft_type: draftType,
            draft_data: cached.data,
            updated_at: cached.updatedAt
          });
        } else {
          clearCache(draftType);
        }
      } finally {
        initializedRef.current = true;
      }
    }

    loadExistingDraft();
    return () => {
      active = false;
    };
  }, [draftType, enabled]);

  useEffect(() => {
    latestDataRef.current = sanitizedState || {};
    latestTitleRef.current = String(titlePreview || "").trim();
    if (!enabled || !dirty || !draftType || !initializedRef.current || restoredRef.current) {
      restoredRef.current = false;
      return undefined;
    }
    if (skipIfEmpty && isEmptyValue(sanitizedState)) return undefined;

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => saveDraft(sanitizedState), SAVE_DELAY_MS);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [dirty, draftType, enabled, sanitizedState, serializedState, saveDraft, skipIfEmpty, titlePreview]);

  useEffect(() => {
    if (!lastError || !enabled || !draftType) return undefined;
    const intervalId = window.setInterval(() => saveDraft(latestDataRef.current), RETRY_DELAY_MS);
    return () => window.clearInterval(intervalId);
  }, [draftType, enabled, lastError, saveDraft]);

  const continueDraft = useCallback(() => {
    if (!bannerDraft) return;
    restoredRef.current = true;
    onRestore?.(bannerDraft.draft_data || {});
    setBannerDraft(null);
  }, [bannerDraft, onRestore]);

  const discardDraft = useCallback(async () => {
    if (!bannerDraft && !draft) return;
    if (!window.confirm("Are you sure you want to delete this draft? This cannot be undone.")) return;
    try {
      const id = bannerDraft?.id || draft?.id;
      if (id) await api.delete(`/drafts/${id}`);
    } catch {
      // Local cleanup still matters if the server draft was already removed elsewhere.
    }
    clearCache(draftType);
    setDraft(null);
    setBannerDraft(null);
    setStatus("idle");
    setStatusText("");
  }, [bannerDraft, draft, draftType]);

  const clearDraft = useCallback(async () => {
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    const id = draft?.id || readCache(draftType)?.draftId;
    try {
      if (id) await api.delete(`/drafts/${id}`);
    } catch {
      // Submit succeeded, so do not block the user's flow on draft cleanup.
    }
    clearCache(draftType);
    setDraft(null);
    setBannerDraft(null);
    setStatus("idle");
    setStatusText("");
  }, [draft?.id, draftType]);

  const banner = bannerDraft ? (
    <div className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm text-text-primary sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 shrink-0 text-warning" size={18} />
        <span>Draft from {timeAgo(bannerDraft.updated_at) || "earlier"}.</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={continueDraft}>Continue editing</Button>
        <Button type="button" size="sm" variant="ghost" className="text-danger hover:text-danger" onClick={discardDraft}>Discard</Button>
      </div>
    </div>
  ) : null;

  const indicator = statusText ? (
    <span className={`text-xs font-semibold ${status === "error" ? "text-warning" : "text-text-muted"}`}>
      {statusText}
    </span>
  ) : null;

  return {
    draft,
    banner,
    indicator,
    status,
    saveDraft,
    clearDraft,
    discardDraft,
    continueDraft
  };
}
