import { useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from "lucide-react";
import toast, { Toaster, useToasterStore } from "react-hot-toast";

const icons = {
  success: CheckCircle2,
  error: AlertCircle,
  warning: TriangleAlert,
  info: Info
};

export function ToastViewport() {
  const { toasts } = useToasterStore();

  useEffect(() => {
    const visibleToasts = toasts.filter(item => item.visible);
    if (visibleToasts.length <= 4) return;
    visibleToasts
      .slice(0, visibleToasts.length - 4)
      .forEach(item => toast.remove(item.id));
  }, [toasts]);

  return (
    <Toaster
      position="top-right"
      toastOptions={{
        duration: 5000,
        className: "toastFrame"
      }}
    />
  );
}

function show(type, message, options = {}) {
  const Icon = icons[type] || Info;
  const duration = type === "warning" || type === "error" ? 8000 : 5000;
  return toast.custom(
    toastItem => (
      <div
        role="status"
        aria-live="polite"
        className={`toastFrame ${toastItem.visible ? "toastEnter" : "toastExit"} ${type}`}
      >
        <Icon size={18} />
        <span>{message}</span>
        {options.action && <a href={options.action.href}>{options.action.label}</a>}
        <button type="button" onClick={() => toast.dismiss(toastItem.id)} aria-label="Close toast">
          <X size={16} />
        </button>
      </div>
    ),
    { duration, ...options }
  );
}

export const notify = {
  success: (message, options) => show("success", message, options),
  error: (message, options) => show("error", message, options),
  warning: (message, options) => show("warning", message, options),
  info: (message, options) => show("info", message, options)
};
