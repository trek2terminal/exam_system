import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, Eye, EyeOff, LogIn } from "lucide-react";
import { Button, Input } from "../components/ui";
import { cn } from "../components/ui/utils";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import { useAppStore } from "../store/appStore";

export default function LoginPage({ settings }) {
  const navigate = useNavigate();
  const loadBootstrap = useAppStore(state => state.loadBootstrap);
  const loadDashboard = useAppStore(state => state.loadDashboard);
  const [role, setRole] = useState("student");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loginMeta = useMemo(() => {
    if (role === "teacher") {
      return {
        identifierName: "username",
        identifierLabel: "Teacher Username",
        identifierPlaceholder: "teacher.username"
      };
    }

    return {
      identifierName: "identifier",
      identifierLabel: "Username, Email, or Roll Number",
      identifierPlaceholder: "student@example.com"
    };
  }, [role]);

  const handleSubmit = async event => {
    event.preventDefault();
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/login", {
        role,
        identifier,
        password
      });
      notify.success(data.message || "Login successful");
      const bootstrap = await loadBootstrap();
      if (bootstrap?.auth?.role) await loadDashboard(bootstrap.auth.role);
      const target = (data.redirect || `/react/${role}`).replace(/^\/react/, "") || `/${role}`;
      navigate(target, { replace: true });
    } catch (error) {
      notify.error(error.message || "Could not sign in");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="appShellSurface min-h-screen text-text-primary">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <div className="relative hidden flex-1 overflow-hidden bg-gradient-to-br from-brand-primary via-indigo-500 to-info p-8 text-white lg:flex lg:flex-col lg:justify-center">
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute -right-32 -top-32 h-64 w-64 rounded-full bg-white/10 blur-3xl animate-float-slow" />
            <div className="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-white/10 blur-3xl" style={{ animationDelay: "2s" }} />
            <div className="absolute bottom-1/4 right-1/3 h-32 w-32 rounded-full bg-white/5 blur-2xl" style={{ animationDelay: "4s" }} />
          </div>

          <div className="relative z-10">
            <div className="mb-8 flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-lg bg-white/20 text-xl font-bold">EP</span>
              <h1 className="text-4xl font-bold">{settings?.platform_name || "Exam Platform"}</h1>
            </div>
            <p className="max-w-sm text-lg text-white/90">
              Assessment made simple. Focused, secure, and ready for every exam session.
            </p>
            <div className="mt-12 space-y-4 text-sm text-white/85">
              {[
                "Real-time proctoring and monitoring",
                "Multiple question types and formats",
                "Instant results and detailed analytics",
                "Code execution support with live testing"
              ].map(item => (
                <p key={item} className="flex items-center gap-3">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-white/20">
                    <CheckCircle2 size={14} />
                  </span>
                  {item}
                </p>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-1 flex-col justify-center px-4 py-12 transition-colors sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-sm rounded-card border border-border bg-background-card p-6 shadow-elevated sm:p-8">
            <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-primary text-base font-bold text-white">EP</span>
              <h2 className="text-2xl font-bold text-text-primary">{settings?.platform_name || "Exam Platform"}</h2>
            </div>

            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold text-text-primary">Welcome back</h1>
              <p className="mt-2 text-text-secondary">Sign in to continue to your workspace</p>
            </div>

            <div className="mb-8 flex gap-3" role="tablist" aria-label="Login role">
              {["student", "teacher"].map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRole(item)}
                  className={cn(
                    "min-h-11 flex-1 rounded-pill px-4 py-2.5 text-sm font-semibold transition duration-150",
                    role === item
                      ? "bg-brand-primary text-white shadow-md"
                      : "border border-border bg-background-surface text-text-secondary hover:bg-background-elevated"
                  )}
                >
                  {item.charAt(0).toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <Input
                label={loginMeta.identifierLabel}
                name={loginMeta.identifierName}
                type="text"
                placeholder={loginMeta.identifierPlaceholder}
                value={identifier}
                onChange={event => setIdentifier(event.target.value)}
                autoComplete="username"
                required
              />

              <div className="relative">
                <Input
                  label="Password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="********"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(current => !current)}
                  className="absolute right-3 top-10 grid h-8 w-8 place-items-center rounded-md text-text-muted transition hover:bg-background-elevated hover:text-text-primary"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              <Button type="submit" variant="primary" size="md" loading={submitting} loadingLabel="Signing in..." className="w-full">
                <LogIn size={18} /> Sign in
              </Button>
            </form>

            <div className="mt-6 space-y-3 text-center text-sm">
              <div className="text-text-secondary">
                Do not have a student account?{" "}
                <Link to="/register" className="font-semibold text-brand-primary transition hover:text-brand-hover">
                  Create one
                </Link>
              </div>
              <Link to="/admin/login" className="block text-xs font-semibold text-text-muted transition hover:text-text-primary">
                Admin sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
