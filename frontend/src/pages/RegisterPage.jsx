import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Check, CheckCircle2, Eye, EyeOff, UserPlus } from "lucide-react";
import { Button, Input, PlatformLogo, ProgressBar } from "../components/ui";
import { cn } from "../components/ui/utils";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import { useAppStore } from "../store/appStore";

export default function RegisterPage({ settings }) {
  const navigate = useNavigate();
  const loadBootstrap = useAppStore(state => state.loadBootstrap);
  const loadDashboard = useAppStore(state => state.loadDashboard);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [registrationCode, setRegistrationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const validations = useMemo(() => ({
    length: password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*]/.test(password)
  }), [password]);

  const strength = useMemo(() => {
    const score = Object.values(validations).filter(Boolean).length;
    if (score <= 2) return { level: "Weak", percent: 33, color: "danger" };
    if (score <= 3) return { level: "Fair", percent: 66, color: "warning" };
    return { level: "Strong", percent: 100, color: "success" };
  }, [validations]);

  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const needsRegistrationCode = Boolean(settings?.registration_code_required);
  const isFormValid = Boolean(
    fullName
    && username
    && rollNumber
    && (!needsRegistrationCode || registrationCode.trim())
    && password
    && confirmPassword
    && passwordsMatch
    && validations.length
    && validations.uppercase
    && validations.number
    && validations.special
  );
  const platformName = settings?.platform_name || "Exam Platform";

  const handleSubmit = async event => {
    event.preventDefault();
    if (!isFormValid) return;
    setSubmitting(true);
    try {
      const { data } = await api.post("/auth/register", {
        name: fullName,
        username,
        email,
        roll_no: rollNumber,
        registration_code: registrationCode,
        password,
        confirm_password: confirmPassword
      });
      notify.success(data.message || "Student account created");
      const bootstrap = await loadBootstrap();
      if (bootstrap?.auth?.role) await loadDashboard(bootstrap.auth.role);
      navigate("/student", { replace: true });
    } catch (error) {
      notify.error(error.message || "Could not create account");
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
              <PlatformLogo
                src={settings?.logo_url}
                name={platformName}
                size="lg"
                className="border-white/25 bg-white/15"
                fallbackClassName="bg-brand-primary"
              />
              <h1 className="text-4xl font-bold">{platformName}</h1>
            </div>
            <p className="max-w-sm text-lg text-white/90">
              Create your student account and move straight into a focused exam workspace.
            </p>
            <div className="mt-12 space-y-4 text-sm text-white/85">
              {[
                "Secure account registration",
                "Quick access to assigned exams",
                "Live status, results, and feedback",
                "Dark mode ready across the platform"
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
          <div className="mx-auto w-full max-w-md rounded-card border border-border bg-background-card p-6 shadow-elevated sm:p-8">
            <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
              <PlatformLogo src={settings?.logo_url} name={platformName} size="sm" />
              <h2 className="text-2xl font-bold text-text-primary">{platformName}</h2>
            </div>

            <div className="mb-8 text-center">
              <h1 className="text-3xl font-bold text-text-primary">Create student account</h1>
              <p className="mt-2 text-text-secondary">Create your account to access assigned exams and results.</p>
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Input
                  label="Full Name"
                  name="name"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={event => setFullName(event.target.value)}
                  autoComplete="name"
                  required
                />
                <Input
                  label="Username"
                  name="username"
                  placeholder="john2026"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  helperText="At least 4 characters"
                  autoComplete="username"
                  required
                />
              </div>

              <Input
                label="Email Address"
                name="email"
                type="email"
                placeholder="student@example.com"
                value={email}
                onChange={event => setEmail(event.target.value)}
                autoComplete="email"
              />

              <Input
                label="Roll Number"
                name="roll_no"
                placeholder="e.g., 2026001"
                value={rollNumber}
                onChange={event => setRollNumber(event.target.value.toUpperCase())}
                required
              />

              {needsRegistrationCode && (
                <Input
                  label="Registration Code"
                  name="registration_code"
                  placeholder="Enter the code from your school"
                  value={registrationCode}
                  onChange={event => setRegistrationCode(event.target.value)}
                  required
                />
              )}

              <PasswordField
                label="Password"
                name="password"
                value={password}
                show={showPassword}
                onToggle={() => setShowPassword(current => !current)}
                onChange={event => setPassword(event.target.value)}
                autoComplete="new-password"
              />

              {password && (
                <div className="space-y-3 rounded-lg border border-border/50 bg-background-elevated/30 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-text-primary">Password strength</span>
                    <span className="text-sm font-semibold text-text-secondary">{strength.level}</span>
                  </div>
                  <ProgressBar value={strength.percent} max={100} variant={strength.color} />
                  <div className="grid grid-cols-1 gap-2 text-xs text-text-secondary sm:grid-cols-2">
                    <ValidationItem active={validations.length}>8+ characters</ValidationItem>
                    <ValidationItem active={validations.uppercase}>Uppercase letter</ValidationItem>
                    <ValidationItem active={validations.lowercase}>Lowercase letter</ValidationItem>
                    <ValidationItem active={validations.number}>Number</ValidationItem>
                    <ValidationItem active={validations.special}>Special character (!@#$%^&*)</ValidationItem>
                  </div>
                </div>
              )}

              <PasswordField
                label="Confirm Password"
                name="confirm_password"
                value={confirmPassword}
                show={showConfirm}
                onToggle={() => setShowConfirm(current => !current)}
                onChange={event => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                error={confirmPassword && !passwordsMatch ? "Passwords do not match" : ""}
              />

              <Button
                type="submit"
                variant="primary"
                size="md"
                loading={submitting}
                loadingLabel="Creating account..."
                disabled={!isFormValid}
                className="w-full"
              >
                <UserPlus size={18} /> Create Account
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-text-secondary">
              Already have an account?{" "}
              <Link to="/login" className="font-semibold text-brand-primary transition hover:text-brand-hover">
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordField({ label, name, value, onChange, show, onToggle, error, autoComplete }) {
  return (
    <div className="relative">
      <Input
        label={label}
        name={name}
        type={show ? "text" : "password"}
        placeholder="********"
        value={value}
        onChange={onChange}
        error={error}
        autoComplete={autoComplete}
        required
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-3 top-10 grid h-8 w-8 place-items-center rounded-md text-text-muted transition hover:bg-background-elevated hover:text-text-primary"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  );
}

function ValidationItem({ active, children }) {
  return (
    <span className="flex items-center gap-2">
      <span className={cn("grid h-4 w-4 place-items-center rounded border", active ? "border-success bg-success text-white" : "border-border")}>
        {active && <Check size={12} />}
      </span>
      {children}
    </span>
  );
}
