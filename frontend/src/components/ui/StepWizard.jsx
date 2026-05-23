import { Check } from "lucide-react";
import { Button } from "./Button";
import { cn } from "./utils";

export function StepWizard({
  steps = [],
  currentStep = 0,
  onBack,
  onNext,
  nextDisabled = false,
  nextLabel = "Next",
  backLabel = "Back",
  children
}) {
  return (
    <section className="rounded-card border border-border bg-background-card shadow-card">
      <header className="border-b border-border px-5 py-4">
        <div className="hidden items-start md:flex">
          {steps.map((step, index) => {
            const active = index === currentStep;
            const done = index < currentStep;
            return (
              <div className="flex flex-1 items-start" key={step.label}>
                <div className="grid place-items-center gap-2 text-center">
                  <span className={cn(
                    "grid h-9 w-9 place-items-center rounded-full border text-sm font-bold",
                    done && "border-success bg-success text-white",
                    active && "border-brand-primary bg-brand-primary text-white",
                    !done && !active && "border-border bg-background-surface text-text-muted"
                  )}>
                    {done ? <Check size={18} /> : index + 1}
                  </span>
                  <span className="text-xs font-semibold text-text-secondary">{step.label}</span>
                </div>
                {index < steps.length - 1 && <span className="mt-4 h-px flex-1 bg-border" />}
              </div>
            );
          })}
        </div>
        <div className="md:hidden">
          <span className="text-xs font-semibold uppercase text-text-muted">Step {currentStep + 1} of {steps.length}</span>
          <h3 className="text-lg font-semibold text-text-primary">{steps[currentStep]?.label}</h3>
        </div>
      </header>
      <div className="px-5 py-5">{children}</div>
      <footer className="flex justify-between gap-3 border-t border-border px-5 py-4">
        <Button variant="secondary" disabled={currentStep === 0} onClick={onBack}>{backLabel}</Button>
        <Button disabled={nextDisabled} onClick={onNext}>{nextLabel}</Button>
      </footer>
    </section>
  );
}
