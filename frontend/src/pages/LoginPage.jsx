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

  useEffect(() => {
    if (!conflictMessage) return undefined;
    const timeoutId = window.setTimeout(() => setConflictMessage(""), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [conflictMessage]);

  const panelContent = platformSettings.loginPage;
  const enabledFeatures = panelContent.features.filter(feature => feature.enabled !== false);

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
        setConflictMessage(data.conflict_message || "Another session on a different device has been signed out.");
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
    <div className="loginCyberScene min-h-screen bg-[#0d0f1a] text-white">
      <div className="flex min-h-screen flex-col lg:flex-row">
        <aside className="authPanelPro loginCyberPanel relative hidden flex-1 overflow-hidden p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-16">
          <div className="authSignalMesh" />

          <div className="relative z-10 max-w-2xl">
            <div className="mb-10 inline-flex items-center gap-4">
              {platformSettings.logoUrl ? (
                <img
                  src={platformSettings.logoUrl}
                  alt={`${platformSettings.platformName} logo`}
                  className="h-14 w-14 rounded-2xl border border-white/10 bg-white/5 object-contain p-1"
                />
              ) : (
                <div className="relative grid h-16 w-16 place-items-center">
                  <div className="absolute inset-0 rotate-45 rounded-2xl border border-indigo-300/70 bg-indigo-500/10 shadow-[0_0_36px_rgba(99,102,241,0.65)]" />
                  <div className="absolute inset-2 rotate-45 rounded-xl bg-[#0f0c29]/70 shadow-inner shadow-cyan-300/20" />
                  <Shield className="relative z-10 h-8 w-8 text-cyan-200 drop-shadow-[0_0_12px_rgba(103,232,249,0.75)]" />
                </div>
              )}
              <div>
                {settingsLoading ? (
                  <div className="h-12 w-80 max-w-[40vw] animate-pulse rounded-xl bg-white/10" />
                ) : (
                  <h1 className="text-5xl font-black tracking-tight text-white">{panelContent.heading || platformSettings.platformName}</h1>
                )}
                <div className="loginBrandUnderline mt-3 h-0.5 rounded-full bg-gradient-to-r from-cyan-300 via-indigo-300 to-purple-300" />
              </div>
            </div>

            <p className="max-w-xl text-lg font-light italic text-cyan-300/70">
              {panelContent.tagline}
            </p>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300/80">
              {panelContent.subheading}
            </p>

            <div className="mt-14 space-y-5">
              {enabledFeatures.map((item, index) => {
                const Icon = featureIconMap[item.icon] || Shield;
                return (
                  <div
                    key={`${item.text}-${index}`}
                    className="loginFeatureItem flex items-center gap-4 text-sm text-gray-300 transition-all duration-200 hover:translate-x-1 hover:text-white"
                    style={{ animationDelay: `${120 + index * 90}ms` }}
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/5 text-indigo-400 shadow-lg shadow-indigo-950/30">
                      <Icon size={20} />
                    </span>
                    <span>{item.text}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {panelContent.securityBadgeEnabled && panelContent.securityBadgeText && (
            <div className="relative z-10 inline-flex w-fit items-center gap-2 rounded-full border border-cyan-300/20 bg-white/5 px-4 py-2 text-xs font-semibold text-cyan-100/80 backdrop-blur-xl">
              <Lock size={14} />
              {panelContent.securityBadgeText}
            </div>
          )}
        </aside>

        <main className="flex flex-1 items-center justify-center bg-[#0d0f1a] px-4 py-10 sm:px-6 lg:px-10">
          <section className="authFormPanelPro w-full max-w-md rounded-3xl border border-white/10 border-t-indigo-500/40 bg-white/5 p-6 shadow-[0_0_60px_rgba(99,102,241,0.15)] backdrop-blur-xl sm:p-10">
            <div className="mb-8 text-center">
              <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl border border-indigo-300/30 bg-indigo-500/10 shadow-[0_0_28px_rgba(99,102,241,0.35)] lg:hidden">
                <Shield className="h-7 w-7 text-cyan-200" />
              </div>
              <div className="mb-2 flex items-center justify-center gap-3">
                <span className="h-2.5 w-2.5 rounded-full bg-cyan-300 shadow-[0_0_16px_rgba(103,232,249,0.9)]" />
                <h2 className="bg-gradient-to-r from-white via-indigo-100 to-cyan-200 bg-clip-text text-4xl font-black tracking-tight text-transparent">
                  Welcome back
                </h2>
              </div>
              <p className="text-sm text-gray-400">Sign in to continue to your secure workspace</p>
            </div>

            <div className="authRoleTabs mb-8 flex gap-1 rounded-2xl border border-white/10 bg-white/5 p-1" role="tablist" aria-label="Login role">
              {["student", "teacher"].map(item => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRole(item)}
                  className={cn(
                    "min-h-11 flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all duration-200",
                    role === item
                      ? "bg-gradient-to-r from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/30"
                      : "text-gray-400 hover:bg-white/5 hover:text-white"
                  )}
                >
                  {item.charAt(0).toUpperCase() + item.slice(1)}
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
                    className="authInputPro w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pl-10 text-white outline-none transition-all placeholder:text-gray-600 focus:border-transparent focus:ring-2 focus:ring-indigo-500"
                  />
                </span>
              </label>

              <label className="grid gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-widest text-gray-400">Password</span>
                <span className="relative block">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                  <input
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    autoComplete="current-password"
                    required
                    className="authInputPro w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 pl-10 pr-12 text-white outline-none transition-all placeholder:text-gray-600 focus:border-transparent focus:ring-2 focus:ring-indigo-500"
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
                className="authActionButton group inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500 px-5 py-3.5 text-base font-bold text-white shadow-[0_0_30px_rgba(99,102,241,0.4)] transition-all duration-200 hover:scale-[1.02] hover:shadow-[0_0_45px_rgba(99,102,241,0.6)] disabled:pointer-events-none disabled:opacity-70"
              >
                {submitting ? (
                  <>
                    <span className="h-5 w-5 rounded-full border-2 border-white/60 border-t-white animate-spin" aria-hidden="true" />
                    Signing in...
                  </>
                ) : (
                  <>
                    Sign in
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
                Do not have a student account?{" "}
                <Link to="/register" className="font-semibold text-indigo-400 underline-offset-2 transition hover:text-indigo-300 hover:underline">
                  Create one
                </Link>
              </div>
              <Link
                to="/admin/login"
                className="mx-auto inline-flex items-center justify-center rounded-lg border border-white/10 px-4 py-1.5 text-xs font-semibold text-gray-500 transition hover:border-white/30 hover:text-white"
              >
                Admin sign in
              </Link>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
