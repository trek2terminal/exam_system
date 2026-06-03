import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import toast, { Toaster, useToasterStore } from "react-hot-toast";

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info
};

const MAX_VISIBLE_TOASTS = 3;
const DEFAULT_DURATIONS = {
  success: 2600,
  info: 3200,
  warning: 5200,
  error: 6500
};
const toastTimers = new Map();

function dismissToast(id) {
  if (toastTimers.has(id)) {
    window.clearTimeout(toastTimers.get(id));
    toastTimers.delete(id);
  }
  toast.dismiss(id);
}

export function ToastViewport() {
  const { toasts } = useToasterStore();

  useEffect(() => {
    const visibleToasts = toasts.filter(item => item.visible);
    if (visibleToasts.length <= MAX_VISIBLE_TOASTS) return;
    visibleToasts
      .slice(0, visibleToasts.length - MAX_VISIBLE_TOASTS)
      .forEach(item => dismissToast(item.id));
  }, [toasts]);

  return (
    <Toaster
      position="top-right"
      gutter={10}
      containerStyle={{
        top: 84,
        right: 18,
        left: "auto",
        width: "min(380px, calc(100vw - 32px))",
        zIndex: 9999
      }}
      toastOptions={{
        duration: DEFAULT_DURATIONS.info,
        className: "toastFrame"
      }}
    />
  );
}

function show(type, message, options = {}) {
  const Icon = icons[type] || Info;
  const { action, duration: optionDuration, id: optionId, dedupe = true, ...toastOptions } = options;
  const duration = optionDuration ?? DEFAULT_DURATIONS[type] ?? DEFAULT_DURATIONS.info;
  const id = optionId || (dedupe ? `${type}:${message}` : undefined);
  const createdId = toast.custom(
    toastItem => (
      <div
        role="status"
        aria-live="polite"
        className={`toastFrame ${toastItem.visible ? "toastEnter" : "toastExit"} ${type}`}
      >
        <Icon size={18} />
        <span>{message}</span>
        {action && <a href={action.href}>{action.label}</a>}
        <button type="button" onClick={() => dismissToast(toastItem.id)} aria-label="Close toast">
          <X size={16} />
        </button>
      </div>
    ),
    { id, duration, removeDelay: 220, ...toastOptions }
  );
  if (Number.isFinite(duration) && duration > 0) {
    if (toastTimers.has(createdId)) window.clearTimeout(toastTimers.get(createdId));
    toastTimers.set(createdId, window.setTimeout(() => dismissToast(createdId), duration));
  }
  return createdId;
}

export const notify = {
  success: (message, options) => show("success", message, options),
  error: (message, options) => show("error", message, options),
  warning: (message, options) => show("warning", message, options),
  info: (message, options) => show("info", message, options)
};
