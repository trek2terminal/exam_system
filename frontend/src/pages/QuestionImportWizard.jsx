import { useState } from "react";
import { Trash2, Upload } from "lucide-react";
import { Button, Input, Textarea, StepWizard } from "../components/ui";

export default function QuestionImportWizard({ onImport }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [importMethod, setImportMethod] = useState("paste");
  const [pastedText, setPastedText] = useState("");
  const [uploadedFile, setUploadedFile] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [unmatched, setUnmatched] = useState("");

  const handleNext = () => {
    if (currentStep === 2) {
      if (questions.length > 0) onImport?.(questions);
      return;
    }
    if (currentStep === 0) {
      parseQuestions();
    } else if (currentStep === 1) {
      // Validation happens here
      if (questions.length === 0) return;
    }
    if (currentStep < 2) setCurrentStep(currentStep + 1);
  };

  const handleBack = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const parseQuestions = () => {
    const rawText = importMethod === "paste" ? pastedText : uploadedFile?.content || "";
    const lines = rawText.split("\n").filter(l => l.trim());
    const parsed = [];
    let unmatchedLines = [];

    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;

      // Simple parser: Look for patterns like "Q1: text? A)opt1 B)opt2 C)opt3 D)opt4"
      const qMatch = trimmed.match(/^(?:Q\d+:|[\dA-Z]+\.)\s*(.*?)\s*(?:\?|$)/i);
      if (qMatch) {
        const questionText = qMatch[1];
        const optionMatch = trimmed.match(/[A-D]\)\s*([^A-D]*?)(?=[A-D]\)|$)/g);
        const options = optionMatch ? optionMatch.map(o => o.replace(/^[A-D]\)\s*/, "")) : [];

        parsed.push({
          id: Date.now() + Math.random(),
          text: questionText,
          type: options.length > 0 ? "mcq" : "short_answer",
          options,
          max_marks: 1
        });
      } else {
        unmatchedLines.push(trimmed);
      }
    });

    setQuestions(parsed);
    setUnmatched(unmatchedLines.join("\n"));
  };

  const updateQuestion = (id, field, value) => {
    setQuestions(prev => prev.map(q => q.id === id ? { ...q, [field]: value } : q));
  };

  const deleteQuestion = (id) => {
    setQuestions(prev => prev.filter(q => q.id !== id));
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new window.FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      setUploadedFile({ name: file.name, content });
    };
    reader.readAsText(file);
  };

  const steps = [
    { label: "Import Source" },
    { label: "Review Questions" },
    { label: "Confirm Import" }
  ];

  return (
    <StepWizard
      steps={steps}
      currentStep={currentStep}
      onNext={handleNext}
      onBack={handleBack}
      nextLabel={currentStep === 2 ? `Import ${questions.length} Questions` : "Next"}
      nextDisabled={
        currentStep === 0 && !pastedText && !uploadedFile ? true :
        currentStep === 1 && questions.length === 0 ? true :
        currentStep === 2 && questions.length === 0 ? true :
        false
      }
    >
      {currentStep === 0 && (
        <div className="space-y-5">
          <div className="flex gap-3">
            {["paste", "upload"].map(method => (
              <button
                key={method}
                type="button"
                onClick={() => setImportMethod(method)}
                className={`flex-1 rounded-lg border px-4 py-3 font-semibold transition ${
                  importMethod === method
                    ? "border-brand-primary bg-brand-primary/10 text-brand-primary"
                    : "border-border hover:bg-background-elevated"
                }`}
              >
                {method === "paste" ? "Paste Text" : "Upload File"}
              </button>
            ))}
          </div>

          {importMethod === "paste" ? (
            <Textarea
              label="Paste your questions here"
              placeholder={`Format example:\nQ1: What is 2+2?\nA) 3 B) 4 C) 5 D) 6\n\nQ2: Explain photosynthesis`}
              value={pastedText}
              onChange={e => setPastedText(e.target.value)}
              rows={8}
            />
          ) : (
            <div className="space-y-3">
              <label className="block">
                <div className="rounded-lg border-2 border-dashed border-border bg-background-elevated/50 p-8 text-center transition hover:border-brand-primary hover:bg-brand-primary/5">
                  <Upload size={32} className="mx-auto mb-3 text-text-muted" />
                  <p className="font-semibold text-text-primary">Drop file here or click to browse</p>
                  <p className="text-sm text-text-muted">Supported: .txt, .csv, .xlsx</p>
                  <input
                    type="file"
                    onChange={handleFileUpload}
                    accept=".txt,.csv,.xlsx"
                    className="hidden"
                  />
                </div>
              </label>
              {uploadedFile && (
                <p className="text-sm font-semibold text-success">Uploaded: {uploadedFile.name}</p>
              )}
            </div>
          )}
        </div>
      )}

      {currentStep === 1 && (
        <div className="space-y-5">
          <div>
            <h3 className="mb-3 font-semibold text-text-primary">Detected Questions ({questions.length})</h3>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {questions.map((q, index) => (
                <div key={q.id} className="rounded-lg border border-border bg-background-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <p className="font-semibold text-text-primary">Q{index + 1}</p>
                      <Textarea
                        value={q.text}
                        onChange={event => updateQuestion(q.id, "text", event.target.value)}
                        rows={2}
                        className="mt-2 text-sm"
                      />
                      <Input
                        label="Marks"
                        type="number"
                        min="1"
                        value={q.max_marks}
                        onChange={event => updateQuestion(q.id, "max_marks", Number(event.target.value))}
                        className="mt-2"
                      />
                      {q.options && q.options.length > 0 && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {q.options.map((opt, i) => (
                            <p key={i} className="text-xs text-text-muted">
                              {String.fromCharCode(65 + i)}. {opt}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteQuestion(q.id)}
                      aria-label="Delete question"
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {unmatched && (
            <div>
              <h3 className="mb-3 font-semibold text-text-primary">Unmatched Content</h3>
              <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
                <p className="text-xs text-text-muted mb-2">These lines could not be parsed automatically:</p>
                <Textarea
                  value={unmatched}
                  readOnly
                  rows={4}
                  className="text-xs"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {currentStep === 2 && (
        <div className="space-y-5">
          <div className="rounded-lg border border-success/30 bg-success/5 p-4 text-sm text-success">
            Ready to import {questions.length} questions into your exam
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs text-text-muted">TOTAL QUESTIONS</p>
              <p className="text-2xl font-bold text-text-primary">{questions.length}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">MULTIPLE CHOICE</p>
              <p className="text-2xl font-bold text-text-primary">{questions.filter(q => q.type === "mcq").length}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">SHORT ANSWER</p>
              <p className="text-2xl font-bold text-text-primary">{questions.filter(q => q.type === "short_answer").length}</p>
            </div>
            <div>
              <p className="text-xs text-text-muted">CODE</p>
              <p className="text-2xl font-bold text-text-primary">{questions.filter(q => q.type === "code").length}</p>
            </div>
          </div>
        </div>
      )}
    </StepWizard>
  );
}
