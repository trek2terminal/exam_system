import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  BarChart2,
  BookOpen,
  Code2,
  Eye,
  EyeOff,
  Layers,
  Lock,
  Shield,
  UserCheck,
  User,
  X,
  Zap
} from "lucide-react";
import { cn } from "../components/ui/utils";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import { useAppStore } from "../store/appStore";
import { usePlatformSettings } from "../hooks/usePlatformSettings";

const featureIconMap = { Shield, BarChart2, Code2, Layers, UserCheck, BookOpen, Lock, Zap };

export default function LoginPage({ settings }) {
  const { settings: platformSettings, loading: settingsLoading } = usePlatformSettings(settings);
  const navigate = useNavigate();
  const loadBootstrap = useAppStore(state => state.loadBootstrap);
  const loadDashboard = useAppStore(state => state.loadDashboard);
  const [role, setRole] = useState("student");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [conflictMessage, setConflictMessage] = useState("");
  const panelContent = platformSettings.loginPage;
  const formContent = platformSettings.loginForm;
  const enabledFeatures = panelContent.features.filter(feature => feature.enabled !== false);

  const loginMeta = useMemo(() => {
    if (role === "teacher") {
      return {
        identifierName: "username",
        identifierLabel: formContent.teacherIdentifierLabel,
        identifierPlaceholder: formContent.teacherIdentifierPlaceholder
      };
    }

    return {
      identifierName: "identifier",
      identifierLabel: formContent.studentIdentifierLabel,
      identifierPlaceholder: formContent.studentIdentifierPlaceholder
    };
  }, [formContent, role]);

  useEffect(() => {
    if (!conflictMessage) return undefined;
    const timeoutId = window.setTimeout(() => setConflictMessage(""), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [conflictMessage]);

  const handleSubmit = async event => {
    event.preventDefault();
    setSubmitting(true);
    setConflictMessage("");
    try {
      const { data } = await api.post("/auth/login", {
        role,
        identifier,
        password
      });
      if (data.session_conflict) {
        setConflictMessage(data.conflict_message || formContent.sessionConflict);
        await new Promise(resolve => window.setTimeout(resolve, 1200));
      }
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
    <div className="loginCyberScene min-h-[100dvh] overflow-y-auto text-white">
      <div className="flex min-h-[100dvh] flex-col lg:flex-row">
        <aside className="authPanelPro loginCyberPanel relative hidden flex-1 overflow-y-auto border-r border-white/10 p-10 text-white lg:sticky lg:top-0 lg:flex lg:h-[100dvh] lg:min-h-[100dvh] lg:self-start xl:p-16">
          <div className="authSignalMesh" />

          <div className="relative z-10 flex min-h-full max-w-3xl flex-col justify-center py-4">
            <div className="mb-10 inline-flex items-center gap-4">
              {platformSettings.logoUrl ? (
                <img
                  src={platformSettings.logoUrl}
                  alt={`${platformSettings.platformName} logo`}
                  className="h-14 w-14 rounded-2xl border border-white/10 bg-white/5 object-contain p-1"
                />
              ) : (
                <div className="relative grid h-16 w-16 place-items-center">
                  <div className="absolute inset-0 rounded-2xl border border-white/10 bg-white/[0.06]" />
                  <Shield className="relative z-10 h-8 w-8 text-indigo-200" />
                </div>
              )}
              <div>
                {settingsLoading ? (
                  <div className="h-12 w-80 max-w-[40vw] animate-pulse rounded-xl bg-white/10" />
                ) : (
                  <h1 className="text-4xl font-semibold tracking-tight text-white xl:text-5xl">{panelContent.heading || platformSettings.platformName}</h1>
                )}
                <div className="loginBrandUnderline mt-4 h-px max-w-40 rounded-full bg-white/25" />
              </div>
            </div>

            <p className="max-w-xl text-lg font-medium text-slate-200">
              {panelContent.tagline}
            </p>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300/80">
              {panelContent.subheading}
            </p>

            <div className="mt-10 space-y-4 xl:mt-12">
              {enabledFeatures.map((item, index) => {
                const Icon = featureIconMap[item.icon] || Shield;
                return (
                  <div
                    key={`${item.text}-${index}`}
                    className="loginFeatureItem flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-3 text-sm text-slate-300 transition-colors duration-200 hover:border-white/[0.14] hover:bg-white/[0.055] hover:text-white"
                    style={{ animationDelay: `${120 + index * 90}ms` }}
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-lg border border-white/[0.08] bg-white/[0.045] text-indigo-300">
                      <Icon size={20} />
                    </span>
                    <span>{item.text}</span>
                  </div>
                );
              })}
            </div>

            {panelContent.securityBadgeEnabled && panelContent.securityBadgeText && (
              <div className="mt-5 inline-flex max-w-full items-center gap-3 self-start rounded-2xl border border-white/[0.10] bg-white/[0.045] px-4 py-3 text-sm font-semibold text-slate-200/85 shadow-[0_16px_42px_rgba(0,0,0,0.14)] backdrop-blur-xl">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-white/[0.10] bg-white/[0.055] text-indigo-200">
                  <Lock size={16} />
                </span>
                <span className="min-w-0 leading-5">{panelContent.securityBadgeText}</span>
              </div>
            )}
          </div>
        </aside>

        <main className="flex min-h-[100dvh] flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:px-10">
          <section className="authFormPanelPro w-full max-w-md rounded-2xl border border-white/10 bg-slate-950/55 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.36)] backdrop-blur-xl sm:p-10">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-white/10 bg-white/[0.055] text-indigo-200 lg:hidden">
                <Shield className="h-7 w-7" />
              </div>
              <h2 className="mb-2 text-3xl font-semibold tracking-tight text-white">{formContent.title}</h2>
              <p className="text-sm text-slate-400">{formContent.subtitle}</p>
            </div>

            <div className="authRoleTabs mb-8 flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1" role="tablist" aria-label="Login role">
              {[
                { id: "student", label: formContent.studentTab },
                { id: "teacher", label: formContent.teacherTab }
              ].map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setRole(item.id)}
                  className={cn(
                    "min-h-11 flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200",
                    role === item.id
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-400 hover:bg-white/[0.055] hover:text-white"
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <form className="space-y-5" onSubmit={handleSubmit}>
              <label className="grid gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">
                  {loginMeta.identifierLabel}
                </span>
                <span className="relative block">
                  <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <input
                    name={loginMeta.identifierName}
                    type="text"
                    placeholder={loginMeta.identifierPlaceholder}
                    value={identifier}
                    onChange={event => setIdentifier(event.target.value)}
                    autoComplete="username"
                    required
                    className="authInputPro w-full rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3 pl-10 text-white outline-none transition-all placeholder:text-slate-600 focus:border-indigo-400/55 focus:ring-2 focus:ring-indigo-500/30"
                  />
                </span>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">{formContent.passwordLabel}</span>
                <span className="relative block">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder={formContent.passwordPlaceholder}
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                    className="authInputPro w-full rounded-xl border border-white/10 bg-white/[0.045] px-4 py-3 pl-10 pr-12 text-white outline-none transition-all placeholder:text-slate-600 focus:border-indigo-400/55 focus:ring-2 focus:ring-indigo-500/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(current => !current)}
                    className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-gray-500 transition hover:bg-white/5 hover:text-gray-300"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </span>
              </label>

              <button
                type="submit"
                disabled={submitting}
                className="authActionButton group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-indigo-500 px-5 py-3.5 text-base font-semibold text-white shadow-lg shadow-indigo-950/30 transition-all duration-200 hover:-translate-y-0.5 hover:bg-indigo-400 disabled:pointer-events-none disabled:opacity-70"
              >
                {submitting ? (
                  <>
                    <span className="authButtonSpinner" aria-hidden="true" />
                    {formContent.submitting}
                  </>
                ) : (
                  <>
                    {formContent.submitButton}
                    <ArrowRight size={18} className="transition-transform duration-200 group-hover:translate-x-1" />
                  </>
                )}
              </button>

              {conflictMessage && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300 animate-fade-in-up">
                  <AlertTriangle size={17} className="mt-0.5 shrink-0" />
                  <span className="flex-1">{conflictMessage}</span>
                  <button
                    type="button"
                    className="grid h-6 w-6 place-items-center rounded-md transition hover:bg-amber-400/15"
                    onClick={() => setConflictMessage("")}
                    aria-label="Dismiss session conflict notice"
                  >
                    <X size={14} />
                  </button>
                </div>
              )}
            </form>

            <div className="mt-6 space-y-3 text-center text-sm">
              <div className="text-gray-500">
                {formContent.studentRegisterPrompt}{" "}
                <Link to="/register" className="font-semibold text-indigo-400 underline-offset-2 transition hover:text-indigo-300 hover:underline">
                  {formContent.studentRegisterLink}
                </Link>
              </div>
              <Link
                to="/admin/login"
                className="mx-auto inline-flex items-center justify-center rounded-lg border border-white/10 px-4 py-1.5 text-xs font-semibold text-slate-500 transition hover:border-white/25 hover:text-white"
              >
                {formContent.adminLink}
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
