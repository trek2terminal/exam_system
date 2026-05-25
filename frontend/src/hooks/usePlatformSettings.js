import { useEffect, useMemo, useState } from "react";
import { api } from "../services/api";

export const defaultPlatformSettings = {
  platformName: "Exam Platform",
  platform_name: "Exam Platform",
  logoUrl: "",
  logo_url: "",
  welcomeMessage: "Welcome to the Exam Platform",
  welcome_message: "Welcome to the Exam Platform",
  registration_code_required: false,
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

export function normalizePlatformSettings(settings) {
  const source = settings || {};
  const loginPage = source.loginPage || source.login_page || {};
  const platformName = source.platformName || source.platform_name || defaultPlatformSettings.platformName;
  const logoUrl = source.logoUrl || source.logo_url || "";
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
    registration_code_required: Boolean(source.registration_code_required),
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
        const { data } = await api.get("/settings/public");
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
