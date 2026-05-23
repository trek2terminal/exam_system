import { Link, useParams } from "react-router-dom";
import { CheckCircle2, FileText, Home } from "lucide-react";
import { Button, Card } from "../components/ui";

export default function StudentSubmittedPage() {
  const { sessionCode } = useParams();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Card className="p-8 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success">
          <CheckCircle2 size={34} />
        </span>
        <h1 className="mt-5 text-3xl font-bold text-text-primary">Exam Submitted</h1>
        <p className="mt-2 text-text-secondary">
          Your attempt has been locked and saved. Results will appear after your teacher publishes them.
        </p>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Session {sessionCode}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Button as={Link} to="/student" variant="primary">
            <Home size={17} /> Dashboard
          </Button>
          <Button as={Link} to="/student/results" variant="secondary">
            <FileText size={17} /> Results
          </Button>
        </div>
      </Card>
    </div>
  );
}
