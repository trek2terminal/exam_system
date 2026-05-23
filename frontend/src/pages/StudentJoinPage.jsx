import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound, LogIn } from "lucide-react";
import { Button, Card, Input } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

function toRouterPath(target) {
  return String(target || "/react/student").replace(/^\/react/, "") || "/student";
}

export default function StudentJoinPage() {
  const navigate = useNavigate();
  const [accessCode, setAccessCode] = useState("");
  const [loading, setLoading] = useState(false);

  const joinExam = async event => {
    event.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/student/join", { access_code: accessCode });
      notify.success(data.message || "Exam session ready");
      navigate(toRouterPath(data.redirect), { replace: false });
    } catch (error) {
      notify.error(error.message || "Could not join exam");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase text-text-muted">Student workspace</p>
        <h1 className="text-3xl font-bold text-text-primary">Join Exam</h1>
        <p className="mt-1 text-text-secondary">Enter the access code shared by your teacher.</p>
      </div>
      <Card className="p-6">
        <form className="space-y-5" onSubmit={joinExam}>
          <div className="grid h-14 w-14 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
            <KeyRound size={26} />
          </div>
          <Input
            label="Access Code"
            value={accessCode}
            onChange={event => setAccessCode(event.target.value.toUpperCase())}
            placeholder="EXAMCODE"
            autoComplete="off"
            required
          />
          <Button type="submit" variant="primary" className="w-full" loading={loading} loadingLabel="Joining...">
            <LogIn size={17} /> Join Exam
          </Button>
        </form>
      </Card>
    </div>
  );
}
