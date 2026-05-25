import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";
import { Input } from "./Input";
import { Modal } from "./Modal";

export function ConfirmationDialog({
  open,
  title = "Confirm action",
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  confirmationWord,
  confirmWord,
  onConfirm,
  onClose,
  loading = false
}) {
  const [typed, setTyped] = useState("");
  const requiredWord = confirmWord || confirmationWord;
  const requiresWord = Boolean(requiredWord);
  const canConfirm = !requiresWord || typed === requiredWord;

  useEffect(() => {
    if (!open) setTyped("");
  }, [open, requiredWord]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{cancelLabel}</Button>
          <Button
            variant={variant}
            disabled={!canConfirm}
            loading={loading}
            loadingLabel="Working"
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-danger/10 text-danger">
            <AlertTriangle size={22} />
          </span>
          {typeof description === "string" ? (
            <p className="text-text-secondary">{description}</p>
          ) : (
            <div className="text-text-secondary">{description}</div>
          )}
        </div>
        {requiresWord && (
          <Input
            label={`Type ${requiredWord} to continue`}
            value={typed}
            onChange={event => setTyped(event.target.value)}
            required
          />
        )}
      </div>
    </Modal>
  );
}
