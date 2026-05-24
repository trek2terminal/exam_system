import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, X } from "lucide-react";
import { useAppStore } from "../store/appStore";
import { api } from "../services/api";

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
    <main className="adminLoginScene">
      <div className="adminLoginShape adminLoginShapeOne" />
      <div className="adminLoginShape adminLoginShapeTwo" />
      <div className="adminLoginShape adminLoginShapeThree" />

      <section className="adminLoginCard" aria-labelledby="admin-login-title">
        <div className="adminShieldGlow" aria-hidden="true">
          <ShieldCheck size={40} />
        </div>
        <h1 id="admin-login-title">Admin Portal</h1>
        <p>Secure access only</p>

        <div className="adminLoginDivider" />

        <form className="grid gap-4" onSubmit={handleSubmit}>
          <label className={`adminLoginField ${shakeKey ? "adminLoginShake" : ""}`} key={`user-${shakeKey}`}>
            <span>Username</span>
            <span className="adminInputWrap">
              <Mail size={18} />
              <input
                value={username}
                onChange={event => setUsername(event.target.value)}
                autoComplete="username"
                placeholder="admin.username"
                required
              />
            </span>
          </label>

          <label className={`adminLoginField ${shakeKey ? "adminLoginShake" : ""}`} key={`pass-${shakeKey}`}>
            <span>Password</span>
            <span className="adminInputWrap">
              <LockKeyhole size={18} />
              <input
                value={password}
                onChange={event => setPassword(event.target.value)}
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(current => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
          </label>

          <button className="adminLoginButton" type="submit" disabled={loading || lockoutSeconds > 0}>
            {loading ? <span className="adminButtonSpinner" aria-label="Signing in" /> : "Sign In"}
          </button>

          {conflictMessage && (
            <div className="adminLoginConflict">
              <span>
                <AlertTriangle size={16} />
                {conflictMessage}
              </span>
              <button type="button" onClick={() => setConflictMessage("")} aria-label="Dismiss session conflict notice">
                <X size={14} />
              </button>
            </div>
          )}

          <div className={`adminLoginError ${displayedError ? "open" : ""}`} aria-live="polite">
            <span>
              <AlertTriangle size={16} />
              {displayedError}
            </span>
          </div>

          {setupRequired && (
            <Link className="text-center text-sm font-semibold text-brand-primary transition hover:text-brand-hover" to="/admin/setup">
              Create the first admin account
            </Link>
          )}
        </form>
      </section>

      <p className="adminLoginReturn">
        Not an admin? <Link to="/login">Return to main login.</Link>
      </p>
    </main>
  );
}
