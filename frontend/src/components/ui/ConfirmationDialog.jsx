import { useState } from "react";
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
  onConfirm,
  onClose,
  loading = false
}) {
  const [typed, setTyped] = useState("");
  const requiresWord = Boolean(confirmationWord);
  const canConfirm = !requiresWord || typed === confirmationWord;

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
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-danger/12 text-danger">
            <AlertTriangle size={22} />
          </span>
          <p className="text-text-secondary">{description}</p>
        </div>
        {requiresWord && (
          <Input
            label={`Type ${confirmationWord} to continue`}
            value={typed}
            onChange={event => setTyped(event.target.value)}
          />
        )}
      </div>
    </Modal>
  );
}
