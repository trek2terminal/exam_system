import { useEffect, useMemo, useState } from "react";
import { cachedGet } from "../services/api";

export const defaultPlatformSettings = {
  platformName: "Exam Platform",
  platform_name: "Exam Platform",
  logoUrl: "",
  logo_url: "",
  welcomeMessage: "Welcome to the Exam Platform",
  welcome_message: "Welcome to the Exam Platform",
  student_self_registration: false,
  studentSelfRegistration: false,
  registration_code_required: false,
  loginForm: {
    title: "Welcome back",
    subtitle: "Sign in to continue to your workspace",
    studentTab: "Student",
    teacherTab: "Teacher",
    studentIdentifierLabel: "Username, Email, or Roll Number",
    studentIdentifierPlaceholder: "student@example.com",
    teacherIdentifierLabel: "Teacher Username",
    teacherIdentifierPlaceholder: "teacher.username",
    passwordLabel: "Password",
    passwordPlaceholder: "Password",
    submitButton: "Sign in",
    submitting: "Signing in...",
    studentRegisterPrompt: "Do not have a student account?",
    studentRegisterLink: "Create one",
    adminLink: "Admin sign in",
    sessionConflict: "Another session on a different device has been signed out."
  },
  registrationPage: {
    accountTitle: "Create student account",
    accountSubtitle: "Create your account to access assigned exams and results.",
    accountButton: "Create Account",
    accountSubmitting: "Creating account...",
    signInPrompt: "Already have an account?",
    signInLink: "Sign in",
    loadingTitle: "Checking registration status",
    loadingSubtitle: "We are preparing the right student access page for you.",
    pausedTitle: "Registration is paused for now",
    pausedSubtitle: "Student self-registration is currently closed. Send your details to the admin and they can help you with access.",
    requestSuccess: "Your message has reached the admin inbox.",
    requestMessageLabel: "Message to Admin",
    requestMessagePlaceholder: "Tell the admin which course, group, or exam access you need.",
    requestMessageHelper: "Minimum 10 characters",
    requestButton: "Send Request to Admin",
    requestSubmitting: "Sending request...",
    requestFooter: "The admin will see this in their notification inbox.",
    requestBackLink: "Back to sign in"
  },
  loginPage: {
    heading: "Exam Platform",
    tagline: "The future of secure, intelligent assessment.",
    subheading: "Focused, secure, and ready for every exam session.",
    features: [
      { icon: "Shield", text: "Real-time proctoring and monitoring", enabled: true },
      { icon: "BarChart2", text: "Multiple question types and formats", enabled: true },
      { icon: "Code2", text: "Instant results and detailed analytics", enabled: true },
      { icon: "Layers", text: "Code execution support with live testing", enabled: true }
    ],
    securityBadgeText: "Secured by end-to-end encryption",
    securityBadgeEnabled: true
  }
};

const fallbackIcons = ["Shield", "BarChart2", "Code2", "Layers", "UserCheck", "BookOpen"];

function normalizeFeatures(features) {
  if (!Array.isArray(features)) return defaultPlatformSettings.loginPage.features;
  const normalized = features
    .map((feature, index) => {
      if (typeof feature === "string") {
        return { icon: fallbackIcons[index % fallbackIcons.length], text: feature.trim(), enabled: true };
      }
      return {
        icon: feature?.icon || fallbackIcons[index % fallbackIcons.length],
        text: String(feature?.text || "").trim(),
        enabled: feature?.enabled !== false
      };
    })
    .filter(feature => feature.text)
    .slice(0, 6);
  return normalized.length ? normalized : defaultPlatformSettings.loginPage.features;
}

function camelizeContent(content) {
  const source = content && typeof content === "object" ? content : {};
  return Object.entries(defaultPlatformSettings.registrationPage).reduce((result, [camelKey, fallback]) => {
    const snakeKey = camelKey.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    const value = source[camelKey] ?? source[snakeKey];
    result[camelKey] = String(value || fallback).trim() || fallback;
    return result;
  }, {});
}

function camelizeLoginForm(content) {
  const source = content && typeof content === "object" ? content : {};
  return Object.entries(defaultPlatformSettings.loginForm).reduce((result, [camelKey, fallback]) => {
    const snakeKey = camelKey.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
    const value = source[camelKey] ?? source[snakeKey];
    result[camelKey] = String(value || fallback).trim() || fallback;
    return result;
  }, {});
}

export function normalizePlatformSettings(settings) {
  const source = settings || {};
  const loginPage = source.loginPage || source.login_page || {};
  const loginFormSource = source.loginForm || source.login_form || source.login_form_content || {};
  const registrationPageSource = source.registrationPage || source.registration_page || source.registration_page_content || {};
  const platformName = source.platformName || source.platform_name || defaultPlatformSettings.platformName;
  const logoUrl = source.logoUrl || source.logo_url || "";
  const selfRegistrationValue = source.student_self_registration ?? source.studentSelfRegistration ?? defaultPlatformSettings.student_self_registration;
  const selfRegistrationEnabled = selfRegistrationValue !== false;
  const features = normalizeFeatures(
    loginPage.features || source.login_page_features || source.login_features
  );

  return {
    ...defaultPlatformSettings,
    ...source,
    platformName,
    platform_name: platformName,
    logoUrl,
    logo_url: logoUrl,
    student_self_registration: selfRegistrationEnabled,
    studentSelfRegistration: selfRegistrationEnabled,
    registration_code_required: Boolean(source.registration_code_required),
    loginForm: camelizeLoginForm(loginFormSource),
    registrationPage: camelizeContent(registrationPageSource),
    loginPage: {
      ...defaultPlatformSettings.loginPage,
      ...loginPage,
      heading: loginPage.heading || source.login_page_heading || source.login_heading || defaultPlatformSettings.loginPage.heading,
      tagline: loginPage.tagline || source.login_page_tagline || source.login_tagline || source.tagline || defaultPlatformSettings.loginPage.tagline,
      subheading: loginPage.subheading || source.login_page_subheading || source.login_subheading || defaultPlatformSettings.loginPage.subheading,
      features,
      securityBadgeText: loginPage.securityBadgeText || source.login_page_security_badge_text || defaultPlatformSettings.loginPage.securityBadgeText,
      securityBadgeEnabled: loginPage.securityBadgeEnabled ?? source.login_page_security_badge_enabled ?? defaultPlatformSettings.loginPage.securityBadgeEnabled
    }
  };
}

export function usePlatformSettings(initialSettings) {
  const [remoteSettings, setRemoteSettings] = useState(null);
  const [loading, setLoading] = useState(!initialSettings);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    async function loadSettings() {
      setLoading(true);
      try {
        const { data } = await cachedGet("/settings/public", { cacheTtl: 60000 });
        if (!active) return;
        setRemoteSettings(data.settings || {});
        setError(null);
      } catch (requestError) {
        if (!active) return;
        setError(requestError);
      } finally {
        if (active) setLoading(false);
      }
    }
    loadSettings();
    return () => {
      active = false;
    };
  }, []);

  const settings = useMemo(
    () => normalizePlatformSettings(remoteSettings || initialSettings || defaultPlatformSettings),
    [initialSettings, remoteSettings]
  );

  return { settings, loading, error };
}
