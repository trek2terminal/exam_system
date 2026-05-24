import { ShieldAlert } from "lucide-react";
import { Button } from "./ui";

export function SessionEndedOverlay({ onLogin }) {
  return (
    <div className="fixed inset-0 z-[9999] grid place-items-center bg-slate-950/85 px-4 backdrop-blur-md animate-page-fade">
      <section className="w-full max-w-md animate-modal-in rounded-card border border-border bg-background-card p-6 text-center shadow-elevated">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-warning/10 text-warning">
          <ShieldAlert size={30} />
        </span>
        <h1 className="text-2xl font-bold text-text-primary">Session Ended</h1>
        <p className="mt-3 text-text-secondary">
          Your account was signed in from another device. You have been signed out of this session.
        </p>
        <Button className="mt-5 w-full" onClick={onLogin}>
          Go to Login
        </Button>
      </section>
    </div>
  );
}
