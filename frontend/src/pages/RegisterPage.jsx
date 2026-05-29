import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  AtSign,
  BarChart2,
  BookOpen,
  Check,
  Clock3,
  Code2,
  Eye,
  EyeOff,
  Hash,
  Layers,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  Send,
  Shield,
  ShieldCheck,
  User,
  UserCheck,
  UserPlus,
  Zap
} from "lucide-react";
import { cn } from "../components/ui/utils";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import { useAppStore } from "../store/appStore";
import { usePlatformSettings } from "../hooks/usePlatformSettings";
import { digitsOnly } from "../utils/inputSanitizers";

const featureIconMap = { Shield, BarChart2, Code2, Layers, UserCheck, BookOpen, Lock, Zap };

export default function RegisterPage({ settings }) {
  const { settings: platformSettings, loading: settingsLoading } = usePlatformSettings(settings);
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
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [requestForm, setRequestForm] = useState({
    fullName: "",
    username: "",
    email: "",
    phone: "",
    rollNumber: "",
    className: "",
    message: ""
  });

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

  const passwordScore = Object.values(validations).filter(Boolean).length;
  const passwordsMatch = password.length > 0 && password === confirmPassword;
  const needsRegistrationCode = Boolean(platformSettings.registration_code_required);
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
  const panelContent = platformSettings.loginPage;
  const enabledFeatures = panelContent.features.filter(feature => feature.enabled !== false);
  const registrationOpen = platformSettings.student_self_registration !== false;
  const isRequestValid = Boolean(
    requestForm.fullName.trim()
    && requestForm.rollNumber.trim()
    && requestForm.message.trim().length >= 10
    && (requestForm.email.trim() || requestForm.phone.trim())
    && (!requestForm.phone.trim() || requestForm.phone.trim().length === 10)
  );

  const updateRequestForm = (field, value) => {
    setRequestForm(current => ({ ...current, [field]: value }));
  };

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

  const handleRequestSubmit = async event => {
    event.preventDefault();
    if (!isRequestValid) return;
    setRequestSubmitting(true);
    try {
      const { data } = await api.post("/registration-requests", {
        full_name: requestForm.fullName,
        preferred_username: requestForm.username,
        email: requestForm.email,
        phone: digitsOnly(requestForm.phone, 10),
        roll_number: requestForm.rollNumber,
        class_name: requestForm.className,
        message: requestForm.message
      });
      notify.success(data.message || "Your request was sent to the admin");
      setRequestSent(true);
      setRequestForm({
        fullName: "",
        username: "",
        email: "",
        phone: "",
        rollNumber: "",
        className: "",
        message: ""
      });
    } catch (error) {
      notify.error(error.message || "Could not send request");
    } finally {
      setRequestSubmitting(false);
    }
  };

  return (
    <div className="loginCyberScene min-h-screen text-white">
      <div className="flex min-h-screen flex-col md:flex-row">
        <aside className="authPanelPro loginCyberPanel relative hidden flex-1 overflow-hidden border-r border-white/10 p-10 text-white md:flex md:flex-col md:justify-between xl:p-16">
          <div className="authSignalMesh" />

          <div className="relative z-10 max-w-xl">
            <div className="mb-8 inline-flex items-center gap-4">
              {platformSettings.logoUrl ? (
                <img
                  src={platformSettings.logoUrl}
                  alt={`${platformSettings.platformName} logo`}
                  className="h-14 w-14 rounded-2xl border border-white/10 bg-white/5 object-contain p-1"
                />
              ) : (
                <div className="relative grid h-14 w-14 place-items-center">
                  <div className="absolute inset-0 rounded-2xl border border-white/10 bg-white/[0.06]" />
                  <Shield className="relative z-10 h-7 w-7 text-indigo-200" />
                </div>
              )}
              <div>
                {settingsLoading ? (
                  <div className="h-10 w-64 max-w-[36vw] animate-pulse rounded-xl bg-white/10" />
                ) : (
                  <h1 className="text-4xl font-semibold tracking-tight text-white">{panelContent.heading || platformSettings.platformName}</h1>
                )}
                <div className="loginBrandUnderline mt-4 h-px max-w-40 rounded-full bg-white/25" />
              </div>
            </div>

            <p className="mt-3 max-w-md text-base font-medium text-slate-200">
              {panelContent.tagline}
            </p>
            <p className="mt-5 max-w-md text-base leading-7 text-slate-300/80">
              {panelContent.subheading}
            </p>

            <div className="mt-12 space-y-5">
              {enabledFeatures.map((item, index) => {
                const Icon = featureIconMap[item.icon] || Shield;
                return (
                  <div
                    key={`${item.text}-${index}`}
                    className="loginFeatureItem flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3 text-sm text-slate-300 transition-colors duration-200 hover:border-white/[0.14] hover:bg-white/[0.055] hover:text-white"
                    style={{ animationDelay: `${120 + index * 100}ms` }}
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.045] text-indigo-300">
                      <Icon size={20} />
                    </span>
                    <span>{item.text}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {panelContent.securityBadgeEnabled && panelContent.securityBadgeText && (
            <div className="relative z-10 inline-flex w-fit items-center gap-2 rounded-full border border-white/10 bg-white/[0.045] px-4 py-2 text-xs font-semibold text-slate-200/80 backdrop-blur-xl">
              <Lock size={14} />
              {panelContent.securityBadgeText}
            </div>
          )}
        </aside>

        <main className="flex flex-1 items-center justify-center px-4 py-6 sm:px-6 lg:px-10">
          <section className="authFormPanelPro registerGlassCard relative mx-auto max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/55 px-5 py-6 shadow-[0_24px_70px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:px-10 sm:py-8">
            {settingsLoading ? (
              <RegistrationLoadingCard />
            ) : !registrationOpen ? (
              <RegistrationPausedCard
                form={requestForm}
                isValid={isRequestValid}
                sent={requestSent}
                submitting={requestSubmitting}
                onChange={updateRequestForm}
                onSubmit={handleRequestSubmit}
              />
            ) : (
              <>
            <div className="text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.055] text-indigo-200">
                <UserPlus className="h-6 w-6" />
              </div>
              <h1 className="mt-4 text-center text-2xl font-semibold tracking-tight text-white">Create student account</h1>
              <p className="mx-auto mt-1 max-w-xs text-center text-sm text-slate-400">
                Create your account to access assigned exams and results.
              </p>
            </div>

            <div className="mb-5 mt-5 h-px w-full bg-white/10" />

            <form className="space-y-5" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <RegisterInput
                  label="Full Name"
                  name="name"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={event => setFullName(event.target.value)}
                  autoComplete="name"
                  required
                  icon={User}
                />
                <RegisterInput
                  label="Username"
                  name="username"
                  placeholder="john2026"
                  value={username}
                  onChange={event => setUsername(event.target.value)}
                  helperText="At least 4 characters"
                  autoComplete="username"
                  required
                  icon={AtSign}
                />
              </div>

              <RegisterInput
                label="Email Address"
                name="email"
                type="email"
                placeholder="student@example.com"
                value={email}
                onChange={event => setEmail(event.target.value)}
                autoComplete="email"
                icon={Mail}
              />

              <RegisterInput
                label="Roll Number"
                name="roll_no"
                placeholder="e.g., 2026001"
                value={rollNumber}
                onChange={event => setRollNumber(event.target.value.toUpperCase())}
                required
                icon={Hash}
              />

              {needsRegistrationCode && (
                <RegisterInput
                  label="Registration Code"
                  name="registration_code"
                  placeholder="Enter the code from your school"
                  value={registrationCode}
                  onChange={event => setRegistrationCode(event.target.value)}
                  required
                  icon={ShieldCheck}
                />
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <PasswordField
                    label="Password"
                    name="password"
                    value={password}
                    show={showPassword}
                    onToggle={() => setShowPassword(current => !current)}
                    onChange={event => setPassword(event.target.value)}
                    autoComplete="new-password"
                    icon={Lock}
                  />
                  <div className="mt-2 flex gap-1" aria-label={`Password strength: ${strength.level}`}>
                    {[1, 2, 3, 4].map(bar => (
                      <span
                        key={bar}
                        className={cn(
                          "h-1 flex-1 rounded-full bg-white/10 transition-colors duration-200",
                          passwordScore >= bar && strengthBarColor(passwordScore)
                        )}
                      />
                    ))}
                  </div>
                </div>

                <PasswordField
                  label="Confirm Password"
                  name="confirm_password"
                  value={confirmPassword}
                  show={showConfirm}
                  onToggle={() => setShowConfirm(current => !current)}
                  onChange={event => setConfirmPassword(event.target.value)}
                  autoComplete="new-password"
                  error={confirmPassword && !passwordsMatch ? "Passwords do not match" : ""}
                  icon={ShieldCheck}
                />
              </div>

              {password && (
                <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-white">Password strength</span>
                    <span className="text-sm font-semibold text-gray-400">{strength.level}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 text-xs text-gray-500 sm:grid-cols-2">
                    <ValidationItem active={validations.length}>8+ characters</ValidationItem>
                    <ValidationItem active={validations.uppercase}>Uppercase letter</ValidationItem>
                    <ValidationItem active={validations.lowercase}>Lowercase letter</ValidationItem>
                    <ValidationItem active={validations.number}>Number</ValidationItem>
                    <ValidationItem active={validations.special}>Special character (!@#$%^&*)</ValidationItem>
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={!isFormValid || submitting}
                className="authActionButton registerCreateButton group mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-5 py-3.5 text-sm font-semibold tracking-wide text-white shadow-lg shadow-indigo-950/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-indigo-400 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-70"
              >
                {submitting ? (
                  <>
                    <span className="authButtonSpinner" aria-hidden="true" />
                    Creating account...
                  </>
                ) : (
                  <>
                    <UserPlus className="h-4 w-4" />
                    Create Account
                  </>
                )}
              </button>
            </form>

            <div className="mt-5 text-center text-sm text-gray-600">
              Already have an account?{" "}
              <Link to="/login" className="inline-flex items-center gap-1 font-medium text-indigo-400 underline-offset-4 transition-colors hover:text-indigo-300 hover:underline">
                Sign in
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
              </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}

function RegistrationLoadingCard() {
  return (
    <div className="py-16 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-white/[0.055] text-indigo-200">
        <span className="authStatusSpinner" aria-label="Checking registration status" />
      </div>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">Checking registration status</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-400">
        We are preparing the right student access page for you.
      </p>
    </div>
  );
}

function RegistrationPausedCard({ form, isValid, sent, submitting, onChange, onSubmit }) {
  return (
    <div>
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.055] text-indigo-200">
          <MessageCircle className="h-7 w-7" />
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-white">Registration is paused for now</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
          Student self-registration is currently closed. Send your details to the admin and they can help you with access.
        </p>
      </div>

      <div className="mb-5 mt-5 h-px w-full bg-white/10" />

      {sent && (
        <div className="mb-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-100">
          Your message has reached the admin inbox.
        </div>
      )}

      <form className="space-y-5" onSubmit={onSubmit}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RegisterInput
            label="Full Name"
            name="request_name"
            placeholder="John Doe"
            value={form.fullName}
            onChange={event => onChange("fullName", event.target.value)}
            autoComplete="name"
            required
            icon={User}
          />
          <RegisterInput
            label="Roll Number"
            name="request_roll"
            placeholder="e.g., 2026001"
            value={form.rollNumber}
            onChange={event => onChange("rollNumber", event.target.value.toUpperCase())}
            required
            icon={Hash}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RegisterInput
            label="Email Address"
            name="request_email"
            type="email"
            placeholder="student@example.com"
            value={form.email}
            onChange={event => onChange("email", event.target.value)}
            autoComplete="email"
            icon={Mail}
            helperText="Email or phone is required"
          />
          <RegisterInput
            label="Phone Number"
            name="request_phone"
            placeholder="Your contact number"
            value={form.phone}
            onChange={event => onChange("phone", digitsOnly(event.target.value, 10))}
            autoComplete="tel"
            inputMode="numeric"
            pattern="[0-9]{10}"
            maxLength={10}
            icon={Phone}
            error={form.phone && form.phone.length !== 10 ? "Enter exactly 10 digits" : ""}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RegisterInput
            label="Preferred Username"
            name="request_username"
            placeholder="john2026"
            value={form.username}
            onChange={event => onChange("username", event.target.value)}
            autoComplete="username"
            icon={AtSign}
          />
          <RegisterInput
            label="Class / Batch"
            name="request_class"
            placeholder="Section A, 2026 batch"
            value={form.className}
            onChange={event => onChange("className", event.target.value)}
            icon={BookOpen}
          />
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">
            Message to Admin<span className="ml-0.5 text-indigo-400">*</span>
          </span>
          <span className="relative block">
            <MessageCircle className="absolute left-3.5 top-4 h-4 w-4 text-gray-500" />
            <textarea
              name="request_message"
              value={form.message}
              onChange={event => onChange("message", event.target.value)}
              placeholder="Tell the admin which course, group, or exam access you need."
              rows={4}
              required
              className="authInputPro w-full resize-y rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 pl-11 text-sm leading-6 text-white outline-none transition-all duration-200 placeholder:text-slate-600 focus:border-indigo-400/55 focus:ring-2 focus:ring-indigo-500/30"
            />
          </span>
          <span className="ml-1 mt-1.5 block text-[11px] text-gray-600">Minimum 10 characters</span>
        </label>

        <button
          type="submit"
          disabled={!isValid || submitting}
          className="authActionButton registerCreateButton group mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-5 py-3.5 text-sm font-semibold tracking-wide text-white shadow-lg shadow-indigo-950/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-indigo-400 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-70"
        >
          {submitting ? (
            <>
              <span className="authButtonSpinner" aria-hidden="true" />
              Sending request...
            </>
          ) : (
            <>
              <Send className="h-4 w-4" />
              Send Request to Admin
            </>
          )}
        </button>
      </form>

      <div className="mt-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-gray-400 sm:flex-row sm:items-center sm:justify-between">
        <span className="inline-flex items-center gap-2">
          <Clock3 className="h-4 w-4 text-indigo-300" />
          The admin will see this in their notification inbox.
        </span>
        <Link to="/login" className="inline-flex items-center gap-1 font-medium text-indigo-400 underline-offset-4 transition-colors hover:text-indigo-300 hover:underline">
          Back to sign in
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}

function RegisterInput({
  label,
  name,
  value,
  onChange,
  placeholder,
  type = "text",
  autoComplete,
  helperText,
  error,
  required = false,
  icon: Icon,
  ...props
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">
        {label}
        {required && <span className="ml-0.5 text-indigo-400">*</span>}
      </span>
      <span className="relative block">
        {Icon && <Icon className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />}
        <input
          name={name}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          autoComplete={autoComplete}
          required={required}
          {...props}
          className={cn(
            "authInputPro w-full rounded-xl border bg-white/[0.04] px-4 py-3 pl-11 text-sm text-white outline-none transition-all duration-200 placeholder:text-slate-600",
            error
              ? "border-red-500/50 focus:border-red-500/40 focus:ring-2 focus:ring-red-500/35"
              : "border-white/[0.08] focus:border-indigo-400/55 focus:ring-2 focus:ring-indigo-500/30"
          )}
        />
      </span>
      {error ? (
        <span className="ml-1 mt-1.5 flex items-center gap-1 text-[11px] text-red-400">
          <AlertCircle className="h-3 w-3" />
          {error}
        </span>
      ) : helperText ? (
        <span className="ml-1 mt-1.5 block text-[11px] text-gray-600">{helperText}</span>
      ) : null}
    </label>
  );
}

function PasswordField({ label, name, value, onChange, show, onToggle, error, autoComplete, icon }) {
  return (
    <div className="relative">
      <RegisterInput
        label={label}
        name={name}
        type={show ? "text" : "password"}
        placeholder="Password"
        value={value}
        onChange={onChange}
        error={error}
        autoComplete={autoComplete}
        required
        icon={icon}
      />
      <button
        type="button"
        onClick={onToggle}
        className="absolute right-3.5 top-[35px] grid h-8 w-8 place-items-center rounded-lg text-gray-600 transition hover:bg-white/5 hover:text-gray-300"
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
      <span className={cn("grid h-4 w-4 place-items-center rounded border", active ? "border-emerald-400 bg-emerald-500 text-white" : "border-white/10")}>
        {active && <Check size={12} />}
      </span>
      {children}
    </span>
  );
}

function strengthBarColor(score) {
  if (score <= 1) return "bg-red-500";
  if (score === 2) return "bg-orange-400";
  if (score === 3) return "bg-yellow-400";
  return "bg-emerald-400";
}
