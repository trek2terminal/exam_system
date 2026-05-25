import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, Eye, EyeOff, Loader2, Lock, Mail, ShieldCheck, X } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { api } from "../services/api";
import { cn } from "../components/ui/utils";

function cleanAdminLoginError(data, fallback = "Invalid credentials.") {
  if (!data) return fallback;
  if (data.server_unlock_required) return "Account locked. Unlock it from the server CLI.";
  if (data.retry_after_seconds) return "Account locked. Try again soon.";
  if (data.message && !String(data.message).startsWith("{")) return data.message;
  return fallback;
}

function formatCountdown(seconds) {
  const remaining = Math.max(Number(seconds || 0), 0);
  const minutes = Math.floor(remaining / 60);
  const secs = remaining % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const loadBootstrap = useAppStore(state => state.loadBootstrap);
  const loadDashboard = useAppStore(state => state.loadDashboard);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [shakeKey, setShakeKey] = useState(0);
  const [setupRequired, setSetupRequired] = useState(false);
  const [conflictMessage, setConflictMessage] = useState("");

  useEffect(() => {
    if (!lockoutSeconds) return undefined;
    const intervalId = window.setInterval(() => {
      setLockoutSeconds(current => Math.max(current - 1, 0));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [lockoutSeconds]);

  useEffect(() => {
    if (!conflictMessage) return undefined;
    const timeoutId = window.setTimeout(() => setConflictMessage(""), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [conflictMessage]);

  const displayedError = useMemo(() => {
    if (lockoutSeconds > 0) return `Account locked. Try again in ${formatCountdown(lockoutSeconds)}.`;
    return error;
  }, [error, lockoutSeconds]);

  const handleSubmit = async event => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setLockoutSeconds(0);
    setSetupRequired(false);
    setConflictMessage("");

    try {
      const { data } = await api.post("/auth/admin-login", { username, password });
      if (data.session_conflict) {
        setConflictMessage(data.conflict_message || "Another session on a different device has been signed out.");
        await new Promise(resolve => window.setTimeout(resolve, 1200));
      }

      const bootstrap = await loadBootstrap();
      if (bootstrap?.auth?.role) await loadDashboard(bootstrap.auth.role);
      navigate((data.redirect || "/react/admin").replace(/^\/react/, "") || "/admin", { replace: true });
    } catch (submitError) {
      const data = submitError.response?.data;
      setShakeKey(current => current + 1);
      setError(cleanAdminLoginError(data, submitError.message || "Invalid credentials."));
      setSetupRequired(Boolean(data?.setup_required));
      if (data?.retry_after_seconds) {
        setLockoutSeconds(Number(data.retry_after_seconds));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="adminMissionScene relative flex min-h-screen items-center justify-center overflow-hidden bg-[#04050f] px-4 py-10 text-white sm:px-6">
      <div className="pointer-events-none absolute left-0 top-0 z-0 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-violet-600/15 blur-[160px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 z-0 h-[500px] w-[500px] translate-x-1/2 translate-y-1/2 rounded-full bg-indigo-500/10 blur-[140px]" />
      <div className="adminMissionDots pointer-events-none absolute inset-0 z-0 opacity-[0.03]" />
      <div className="adminMissionScanline pointer-events-none absolute inset-x-0 top-0 z-0 h-24 opacity-30" />

      <section
        className="adminMissionCard relative z-10 mx-auto w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-[0_0_80px_rgba(109,40,217,0.12)] backdrop-blur-2xl before:absolute before:left-1/2 before:top-0 before:h-px before:w-2/3 before:-translate-x-1/2 before:bg-gradient-to-r before:from-transparent before:via-violet-500 before:to-transparent sm:p-10"
        aria-labelledby="admin-login-title"
      >
        <div className="relative mx-auto mb-6 grid h-16 w-16 place-items-center rounded-2xl border border-violet-500/30 bg-violet-500/10 text-violet-400 shadow-[0_0_35px_rgba(139,92,246,0.22)]">
          <span className="absolute inset-0 rounded-2xl bg-violet-500/20 animate-ping" aria-hidden="true" />
          <ShieldCheck className="relative h-8 w-8" />
        </div>

        <div className="text-center">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/5 px-2.5 py-1 font-mono text-[10px] font-bold tracking-widest text-emerald-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
            SECURE
          </div>
          <h1
            id="admin-login-title"
            className="bg-gradient-to-r from-white via-violet-200 to-white bg-clip-text text-center text-3xl font-black tracking-tight text-transparent"
          >
            Admin Portal
          </h1>
          <p className="mt-2 inline-flex items-center justify-center gap-1.5 text-sm text-gray-500">
            <Lock className="h-3 w-3" />
            Secure access only
          </p>
        </div>

        <div className="my-6 h-px w-full bg-gradient-to-r from-transparent via-white/10 to-transparent" />

        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className={cn("block", shakeKey && "adminLoginShake")} key={`user-${shakeKey}`}>
            <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.15em] text-gray-400">
              Username <span className="text-violet-400">*</span>
            </span>
            <span className="relative block w-full">
              <Mail className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={username}
                onChange={event => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="admin.username"
                required
                className={cn(
                  "w-full rounded-xl border bg-white/[0.04] px-4 py-3.5 pl-11 text-sm text-white outline-none transition-all duration-200 placeholder:text-gray-600",
                  displayedError
                    ? "border-red-500/50 focus:border-red-500/40 focus:ring-2 focus:ring-red-500/40"
                    : "border-white/[0.08] focus:border-violet-500/40 focus:ring-2 focus:ring-violet-500/60 focus:shadow-[0_0_20px_rgba(139,92,246,0.15)]"
                )}
              />
            </span>
          </label>

          <label className={cn("block", shakeKey && "adminLoginShake")} key={`pass-${shakeKey}`}>
            <span className="mb-2 block text-[11px] font-bold uppercase tracking-[0.15em] text-gray-400">
              Password <span className="text-violet-400">*</span>
            </span>
            <span className="relative block w-full">
              <Lock className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={password}
                onChange={event => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Password"
                required
                className={cn(
                  "w-full rounded-xl border bg-white/[0.04] px-4 py-3.5 pl-11 pr-12 text-sm text-white outline-none transition-all duration-200 placeholder:text-gray-600",
                  displayedError
                    ? "border-red-500/50 focus:border-red-500/40 focus:ring-2 focus:ring-red-500/40"
                    : "border-white/[0.08] focus:border-violet-500/40 focus:ring-2 focus:ring-violet-500/60 focus:shadow-[0_0_20px_rgba(139,92,246,0.15)]"
                )}
              />
              <button
                type="button"
                onClick={() => setShowPassword(current => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-600 transition-colors hover:text-gray-300"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          <button
            className="adminMissionButton group mt-8 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 via-indigo-500 to-violet-600 px-5 py-3.5 text-sm font-bold tracking-wide text-white shadow-[0_0_30px_rgba(139,92,246,0.35)] transition-all duration-200 hover:scale-[1.02] hover:brightness-110 hover:shadow-[0_0_50px_rgba(139,92,246,0.5)] disabled:pointer-events-none disabled:opacity-70"
            type="submit"
            disabled={loading || lockoutSeconds > 0}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Authenticating...
              </>
            ) : (
              <>
                Sign In
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </>
            )}
          </button>

          {conflictMessage && (
            <div className="flex items-start justify-between gap-3 rounded-xl border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-sm text-amber-300 animate-fade-in-up">
              <span className="flex items-start gap-2">
                <AlertTriangle size={16} />
                {conflictMessage}
              </span>
              <button
                type="button"
                className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-amber-400/10"
                onClick={() => setConflictMessage("")}
                aria-label="Dismiss session conflict notice"
              >
                <X size={14} />
              </button>
            </div>
          )}

          <div className={cn("overflow-hidden text-xs text-red-400 transition-all duration-200", displayedError ? "max-h-16" : "max-h-0")} aria-live="polite">
            <span className="flex items-center gap-2">
              <AlertTriangle size={16} />
              {displayedError}
            </span>
          </div>

          {setupRequired && (
            <Link className="block text-center text-sm font-semibold text-violet-400 transition hover:text-violet-300" to="/admin/setup">
              Create the first admin account
            </Link>
          )}
        </form>

        <p className="mt-8 text-center text-sm text-gray-600">
          Not an admin?{" "}
          <Link to="/login" className="inline-flex items-center gap-1 font-medium text-violet-400 underline-offset-4 transition-colors hover:text-violet-300 hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" />
            Return to main login.
          </Link>
        </p>
      </section>
    </main>
  );
}
