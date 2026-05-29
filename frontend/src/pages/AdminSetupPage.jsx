import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

function passwordScore(password) {
  const checks = [
    password.length >= 10,
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /[0-9]/.test(password)
  ];
  return checks.filter(Boolean).length;
}

export default function AdminSetupPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState("");
  const [shakeKey, setShakeKey] = useState(0);

  useEffect(() => {
    let alive = true;
    api.get("/auth/admin-setup")
      .then(({ data }) => {
        if (!alive) return;
        if (!data.setup_required) navigate("/admin/login", { replace: true });
      })
      .catch(() => {
        if (alive) setError("Could not check admin setup status.");
      })
      .finally(() => {
        if (alive) setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, [navigate]);

  const score = useMemo(() => passwordScore(password), [password]);
  const valid = name.trim() && username.trim().length >= 5 && score === 4 && password === confirmPassword;
  const strengthLabel = score <= 1 ? "Weak" : score === 2 ? "Fair" : score === 3 ? "Good" : "Strong";

  const handleSubmit = async event => {
    event.preventDefault();
    if (!valid) return;
    setLoading(true);
    setError("");
    try {
      const { data } = await api.post("/auth/admin-setup", {
        name,
        username,
        password,
        confirm_password: confirmPassword
      });
      notify.success(data.message || "Admin account created");
      navigate("/admin/login", { replace: true });
    } catch (setupError) {
      setShakeKey(current => current + 1);
      setError(setupError.message || "Could not create admin account.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="adminLoginScene">
      <div className="authSignalMesh opacity-40" />

      <section className="authFormPanelPro adminLoginCard" aria-labelledby="admin-setup-title">
        <div className="adminShieldGlow" aria-hidden="true">
          <ShieldCheck size={40} />
        </div>
        <h1 id="admin-setup-title">Create Admin Account</h1>
        <p>First secure owner setup</p>

        <div className="adminLoginDivider" />

        {checking ? (
          <div className="grid min-h-40 place-items-center">
            <span className="authStatusSpinner" aria-label="Checking setup status" />
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <label className={`adminLoginField ${shakeKey ? "adminLoginShake" : ""}`} key={`name-${shakeKey}`}>
              <span>Full Name</span>
              <span className="authInputPro adminInputWrap">
                <UserRound size={18} />
                <input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  autoComplete="name"
                  placeholder="Platform Owner"
                  required
                />
              </span>
            </label>

            <label className={`adminLoginField ${shakeKey ? "adminLoginShake" : ""}`} key={`user-${shakeKey}`}>
              <span>Username</span>
              <span className="authInputPro adminInputWrap">
                <UserRound size={18} />
                <input
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="admin.owner"
                  required
                />
              </span>
            </label>

            <label className={`adminLoginField ${shakeKey ? "adminLoginShake" : ""}`} key={`pass-${shakeKey}`}>
              <span>Password</span>
              <span className="authInputPro adminInputWrap">
                <LockKeyhole size={18} />
                <input
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Password"
                  required
                />
                <button type="button" onClick={() => setShowPassword(current => !current)} aria-label={showPassword ? "Hide password" : "Show password"}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            <label className={`adminLoginField ${shakeKey ? "adminLoginShake" : ""}`} key={`confirm-${shakeKey}`}>
              <span>Confirm Password</span>
              <span className="authInputPro adminInputWrap">
                <LockKeyhole size={18} />
                <input
                  value={confirmPassword}
                  onChange={event => setConfirmPassword(event.target.value)}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder="Confirm password"
                  required
                />
              </span>
            </label>

            <div className="rounded-lg border border-border bg-background-surface p-3">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-semibold text-text-secondary">Password strength</span>
                <span className="font-semibold text-text-primary">{strengthLabel}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-pill bg-background-elevated">
                <span
                  className="block h-full rounded-pill bg-brand-primary transition-all duration-200"
                  style={{ width: `${(score / 4) * 100}%` }}
                />
              </div>
            </div>

            <button className="authActionButton adminLoginButton" type="submit" disabled={loading || !valid}>
              {loading ? <span className="adminButtonSpinner" aria-label="Creating admin account" /> : "Create Admin"}
            </button>

            <div className={`adminLoginError ${error ? "open" : ""}`} aria-live="polite">
              <span>
                <AlertTriangle size={16} />
                {error}
              </span>
            </div>
          </form>
        )}
      </section>

      <p className="adminLoginReturn">
        Already set up? <Link to="/admin/login">Return to admin sign in.</Link>
      </p>
    </main>
  );
}
