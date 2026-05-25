import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, BarChart2, Bell, BookOpen, CheckCircle2, Code2, DatabaseBackup, Download, GripVertical, Layers, Lock, Megaphone, Plus, Save, Shield, Settings2, ShieldCheck, Trash2, Upload, UserCheck, UserPlus, X, Zap } from "lucide-react";
import { Badge, Button, Card, CropModal, Input, PlatformLogo, Select, Textarea, Toggle } from "../components/ui";
import { notify } from "../components/ui/Toast";
import { api } from "../services/api";
import { useAppStore } from "../store/appStore";
import { useDraftAutoSave } from "../hooks/useDraftAutoSave";

const tabs = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "registration", label: "Registration", icon: UserPlus },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "announcement", label: "Announcement", icon: Megaphone },
  { id: "backup", label: "Backup", icon: DatabaseBackup },
  { id: "notifications", label: "Notifications", icon: Bell }
];

const defaultLoginFeatures = [
  { icon: "Shield", text: "Real-time proctoring and monitoring", enabled: true },
  { icon: "BarChart2", text: "Multiple question types and formats", enabled: true },
  { icon: "Code2", text: "Instant results and detailed analytics", enabled: true },
  { icon: "Layers", text: "Code execution support with live testing", enabled: true },
  { icon: "UserCheck", text: "Verified student identity checks", enabled: false },
  { icon: "BookOpen", text: "Guided exam access for every learner", enabled: false }
];

const loginFeatureIconOptions = ["Shield", "BarChart2", "Code2", "Layers", "UserCheck", "BookOpen", "Lock", "Zap"].map(icon => ({
  value: icon,
  label: icon
}));

const loginFeatureIcons = { Shield, BarChart2, Code2, Layers, UserCheck, BookOpen, Lock, Zap };

function settingsFeatures(value) {
  if (Array.isArray(value)) {
    return value
      .map((feature, index) => {
        if (typeof feature === "string") {
          return { icon: defaultLoginFeatures[index % defaultLoginFeatures.length].icon, text: feature.trim(), enabled: true };
        }
        return {
          icon: feature?.icon || defaultLoginFeatures[index % defaultLoginFeatures.length].icon,
          text: String(feature?.text || "").trim(),
          enabled: feature?.enabled !== false
        };
      })
      .filter(feature => feature.text)
      .slice(0, 6);
  }
  if (typeof value === "string") {
    return value.split(/\r?\n/).map((item, index) => ({
      icon: defaultLoginFeatures[index % defaultLoginFeatures.length].icon,
      text: item.trim(),
      enabled: true
    })).filter(feature => feature.text).slice(0, 6);
  }
  return defaultLoginFeatures;
}

function settingsList(value) {
  if (Array.isArray(value)) return value.map(item => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  return [];
}

export default function AdminSettings() {
  const [searchParams] = useSearchParams();
  const loadBootstrap = useAppStore(state => state.loadBootstrap);
  const [activeTab, setActiveTab] = useState("general");
  const [loading, setLoading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoRemoving, setLogoRemoving] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [backupPassword, setBackupPassword] = useState("");
  const [quoteDraft, setQuoteDraft] = useState("");
  const [logoCropSrc, setLogoCropSrc] = useState("");
  const [logoFileName, setLogoFileName] = useState("platform-logo.png");

  const [general, setGeneral] = useState({
    platform_name: "Exam Platform",
    logo_url: "",
    welcome_message: "Welcome to the Exam Platform",
    login_page_heading: "Exam Platform",
    login_page_tagline: "The future of secure, intelligent assessment.",
    login_page_subheading: "Focused, secure, and ready for every exam session.",
    login_page_features: defaultLoginFeatures,
    login_page_security_badge_text: "Secured by end-to-end encryption",
    login_page_security_badge_enabled: true,
    quote_pool: [
      "One calm question at a time.",
      "Focus brings success.",
      "You have prepared well, now show it."
    ]
  });
  const [registration, setRegistration] = useState({
    self_registration_enabled: true,
    registration_code_required: false,
    registration_code: ""
  });
  const [security, setSecurity] = useState({
    violation_threshold: 3,
    admin_lockout_count: 3,
    admin_idle_timeout: 120
  });
  const [announcement, setAnnouncement] = useState({
    enabled: false,
    message: ""
  });

  useEffect(() => {
    async function loadSettings() {
      try {
        const { data } = await api.get("/admin/settings");
        const settings = data.settings || {};
        setGeneral(current => ({
          ...current,
          platform_name: settings.platform_name || current.platform_name,
          logo_url: settings.logo_url || "",
          welcome_message: settings.welcome_message || current.welcome_message,
          login_page_heading: settings.login_page_heading || current.login_page_heading,
          login_page_tagline: settings.login_page_tagline || settings.login_tagline || current.login_page_tagline,
          login_page_subheading: settings.login_page_subheading || current.login_page_subheading,
          login_page_features: settingsFeatures(settings.login_page_features),
          login_page_security_badge_text: settings.login_page_security_badge_text || current.login_page_security_badge_text,
          login_page_security_badge_enabled: settings.login_page_security_badge_enabled !== false,
          quote_pool: settingsList(settings.quote_pool).length ? settingsList(settings.quote_pool) : current.quote_pool
        }));
        setRegistration(current => ({
          ...current,
          self_registration_enabled: Boolean(settings.student_self_registration),
          registration_code_required: Boolean(settings.registration_code_required),
          registration_code: settings.registration_code || ""
        }));
        setSecurity(current => ({
          ...current,
          violation_threshold: Number(settings.max_violations_before_alert || current.violation_threshold),
          admin_lockout_count: Number(settings.admin_lockout_count || current.admin_lockout_count),
          admin_idle_timeout: Number(settings.admin_idle_timeout_minutes || current.admin_idle_timeout)
        }));
        setAnnouncement({
          enabled: Boolean(settings.announcement_message),
          message: settings.announcement_message || ""
        });
      } catch {
        notify.warning("Using local defaults for settings form");
      }
    }
    loadSettings();
  }, []);

  useEffect(() => () => {
    if (logoCropSrc) window.URL.revokeObjectURL(logoCropSrc);
  }, [logoCropSrc]);

  const markChanged = setter => (field, value) => {
    setter(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleGeneralChange = markChanged(setGeneral);
  const handleRegistrationChange = markChanged(setRegistration);
  const handleSecurityChange = markChanged(setSecurity);
  const handleAnnouncementChange = markChanged(setAnnouncement);

  const restoreSettingsDraft = data => {
    if (data.general) setGeneral(current => ({ ...current, ...data.general }));
    if (data.registration) setRegistration(current => ({ ...current, ...data.registration }));
    if (data.security) setSecurity(current => ({ ...current, ...data.security }));
    if (data.announcement) setAnnouncement(current => ({ ...current, ...data.announcement }));
    setHasChanges(true);
  };

  const settingsDraft = useDraftAutoSave({
    draftType: "admin_settings",
    formState: { general, registration, security, announcement },
    titlePreview: general.platform_name || "Platform settings",
    onRestore: restoreSettingsDraft,
    dirty: hasChanges
  });

  useEffect(() => {
    const draftId = searchParams.get("draft");
    if (!draftId) return;
    let active = true;
    async function restoreFromQuery() {
      try {
        const { data } = await api.get(`/drafts/${draftId}`);
        if (active && data.draft?.draft_type === "admin_settings") restoreSettingsDraft(data.draft.draft_data || {});
      } catch (error) {
        notify.error(error.message || "Could not restore draft");
      }
    }
    restoreFromQuery();
    return () => {
      active = false;
    };
  }, [searchParams]);

  const addQuote = () => {
    const quote = quoteDraft.trim();
    if (!quote) return;
    setGeneral(current => ({ ...current, quote_pool: [...current.quote_pool, quote] }));
    setQuoteDraft("");
    setHasChanges(true);
  };

  const removeQuote = index => {
    setGeneral(current => ({ ...current, quote_pool: current.quote_pool.filter((_, quoteIndex) => quoteIndex !== index) }));
    setHasChanges(true);
  };

  const updateLoginFeature = (index, field, value) => {
    setGeneral(current => {
      const loginPageFeatures = [...current.login_page_features];
      loginPageFeatures[index] = { ...loginPageFeatures[index], [field]: value };
      return { ...current, login_page_features: loginPageFeatures };
    });
    setHasChanges(true);
  };

  const addLoginFeature = () => {
    setGeneral(current => {
      if (current.login_page_features.length >= 6) return current;
      return { ...current, login_page_features: [...current.login_page_features, { icon: "Shield", text: "", enabled: true }] };
    });
    setHasChanges(true);
  };

  const removeLoginFeature = index => {
    setGeneral(current => ({
      ...current,
      login_page_features: current.login_page_features.filter((_, featureIndex) => featureIndex !== index)
    }));
    setHasChanges(true);
  };

  const moveLoginFeature = (index, direction) => {
    setGeneral(current => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.login_page_features.length) return current;
      const loginPageFeatures = [...current.login_page_features];
      const [feature] = loginPageFeatures.splice(index, 1);
      loginPageFeatures.splice(nextIndex, 0, feature);
      return { ...current, login_page_features: loginPageFeatures };
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    setLoading(true);
    try {
      await api.patch("/admin/settings", {
        platform_name: general.platform_name,
        welcome_message: general.welcome_message,
        login_page_heading: general.login_page_heading,
        login_page_tagline: general.login_page_tagline,
        login_page_subheading: general.login_page_subheading,
        login_page_features: general.login_page_features
          .map(feature => ({
            icon: feature.icon || "Shield",
            text: String(feature.text || "").trim(),
            enabled: feature.enabled !== false
          }))
          .filter(feature => feature.text)
          .slice(0, 6),
        login_page_security_badge_text: general.login_page_security_badge_text,
        login_page_security_badge_enabled: general.login_page_security_badge_enabled,
        announcement_message: announcement.enabled ? announcement.message : "",
        quote_pool: general.quote_pool.join("\n"),
        max_violations_before_alert: security.violation_threshold,
        student_self_registration: registration.self_registration_enabled,
        registration_code_required: registration.registration_code_required,
        registration_code: registration.registration_code,
        admin_lockout_count: security.admin_lockout_count,
        admin_idle_timeout_minutes: security.admin_idle_timeout
      });
      await loadBootstrap();
      await settingsDraft.clearDraft();
      notify.success("Settings saved successfully");
      setHasChanges(false);
    } catch (error) {
      notify.error(error.message || "Failed to save settings");
    } finally {
      setLoading(false);
    }
  };

  const clearLogoCrop = () => {
    setLogoCropSrc(current => {
      if (current) window.URL.revokeObjectURL(current);
      return "";
    });
  };

  const handleLogoUpload = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const allowedExtensions = ["png", "jpg", "jpeg", "webp", "gif"];
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(extension)) {
      notify.error("Logo must be PNG, JPG, WEBP, or GIF.");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      notify.error("Logo must be 2 MB or smaller.");
      return;
    }

    setLogoFileName(file.name.replace(/\.[^.]+$/, ".png") || "platform-logo.png");
    setLogoCropSrc(current => {
      if (current) window.URL.revokeObjectURL(current);
      return window.URL.createObjectURL(file);
    });
  };

  const handleLogoCropConfirm = async blob => {
    const formData = new window.FormData();
    formData.append("logo", blob, logoFileName);
    setLogoUploading(true);
    try {
      const { data } = await api.post("/admin/settings/logo", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      const nextLogoUrl = data.settings?.logo_url || "";
      setGeneral(current => ({ ...current, logo_url: nextLogoUrl }));
      await loadBootstrap();
      notify.success(data.message || "Logo uploaded successfully");
      clearLogoCrop();
    } catch (error) {
      notify.error(error.message || "Logo upload failed");
    } finally {
      setLogoUploading(false);
    }
  };

  const handleLogoRemove = async () => {
    if (!general.logo_url) return;
    setLogoRemoving(true);
    try {
      const { data } = await api.delete("/admin/settings/logo");
      setGeneral(current => ({ ...current, logo_url: data.settings?.logo_url || "" }));
      await loadBootstrap();
      notify.success(data.message || "Logo removed successfully");
    } catch (error) {
      notify.error(error.message || "Logo removal failed");
    } finally {
      setLogoRemoving(false);
    }
  };

  const handleBackup = async event => {
    event.preventDefault();
    if (!backupPassword.trim()) return;
    setBackupLoading(true);
    try {
      const response = await api.post(
        "/admin/settings/backup",
        { admin_password: backupPassword },
        { responseType: "blob" }
      );
      const blobUrl = window.URL.createObjectURL(response.data);
      const link = document.createElement("a");
      const disposition = response.headers?.["content-disposition"] || "";
      const match = disposition.match(/filename="?([^"]+)"?/i);
      link.href = blobUrl;
      link.download = match?.[1] || "exam_backup.db";
      link.click();
      window.URL.revokeObjectURL(blobUrl);
      notify.success("Backup downloaded");
      setBackupPassword("");
    } catch (error) {
      notify.error(error.message || "Backup failed");
    } finally {
      setBackupLoading(false);
    }
  };

  const renderSection = sectionId => (
    <SettingsSection
      sectionId={sectionId}
      general={general}
      registration={registration}
      security={security}
      announcement={announcement}
      backupPassword={backupPassword}
      quoteDraft={quoteDraft}
      onGeneralChange={handleGeneralChange}
      onRegistrationChange={handleRegistrationChange}
      onSecurityChange={handleSecurityChange}
      onAnnouncementChange={handleAnnouncementChange}
      onBackupPasswordChange={setBackupPassword}
      onQuoteDraftChange={setQuoteDraft}
      onAddQuote={addQuote}
      onRemoveQuote={removeQuote}
      onUpdateLoginFeature={updateLoginFeature}
      onAddLoginFeature={addLoginFeature}
      onRemoveLoginFeature={removeLoginFeature}
      onMoveLoginFeature={moveLoginFeature}
      onBackup={handleBackup}
      onLogoUpload={handleLogoUpload}
      onLogoRemove={handleLogoRemove}
      logoUploading={logoUploading}
      logoRemoving={logoRemoving}
      backupLoading={backupLoading}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Administration</p>
          <h1 className="text-3xl font-bold text-text-primary">Platform Settings</h1>
          <p className="mt-1 text-text-secondary">Manage student registration, announcements, violation threshold, and database backup.</p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <Button variant="primary" onClick={handleSave} loading={loading} loadingLabel="Saving..." disabled={!hasChanges}>
            <Save size={16} /> Save Changes
          </Button>
          {settingsDraft.indicator}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
        <Card className="hidden p-3 md:block">
          <nav className="grid gap-1">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex min-h-11 items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition ${
                    activeTab === tab.id ? "bg-brand-primary text-white" : "text-text-secondary hover:bg-background-elevated hover:text-text-primary"
                  }`}
                >
                  <Icon size={18} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </Card>

        <div className="hidden md:block">
          {activeTab === "general" && <div className="mb-4">{settingsDraft.banner}</div>}
          {renderSection(activeTab)}
        </div>

        <div className="space-y-3 md:hidden">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const open = activeTab === tab.id;
            return (
              <Card key={tab.id} className="overflow-hidden">
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left font-semibold text-text-primary"
                  onClick={() => setActiveTab(open ? "" : tab.id)}
                >
                  <span className="inline-flex items-center gap-3"><Icon size={18} /> {tab.label}</span>
                  <span>{open ? "-" : "+"}</span>
                </button>
                {open && <div className="border-t border-border p-4">{renderSection(tab.id)}</div>}
              </Card>
            );
          })}
        </div>
      </div>
      <CropModal
        imageSrc={logoCropSrc}
        aspectRatio={1}
        onConfirm={handleLogoCropConfirm}
        onCancel={clearLogoCrop}
      />
    </div>
  );
}

function SettingsSection({
  sectionId,
  general,
  registration,
  security,
  announcement,
  backupPassword,
  quoteDraft,
  onGeneralChange,
  onRegistrationChange,
  onSecurityChange,
  onAnnouncementChange,
  onBackupPasswordChange,
  onQuoteDraftChange,
  onAddQuote,
  onRemoveQuote,
  onUpdateLoginFeature,
  onAddLoginFeature,
  onRemoveLoginFeature,
  onMoveLoginFeature,
  onBackup,
  onLogoUpload,
  onLogoRemove,
  logoUploading,
  logoRemoving,
  backupLoading
}) {
  if (sectionId === "general") {
    const enabledFeatureCount = general.login_page_features.filter(feature => feature.enabled !== false && feature.text?.trim()).length;
    return (
      <Card className="p-6">
        <div className="space-y-5">
          <h2 className="text-xl font-semibold text-text-primary">General</h2>
          <Input label="Platform Name" value={general.platform_name} onChange={event => onGeneralChange("platform_name", event.target.value)} required />
          <div>
            <label className="mb-3 block font-semibold text-text-primary">Logo</label>
            <div className="rounded-lg border-2 border-dashed border-border bg-background-base p-6 text-center">
              <PlatformLogo
                src={general.logo_url}
                name={general.platform_name}
                size="lg"
                className="mx-auto mb-3"
                fallbackClassName="bg-brand-primary"
              />
              <p className="mb-3 text-sm text-text-secondary">Upload a PNG, JPG, WEBP, or GIF logo up to 2 MB.</p>
              <div className="flex flex-col justify-center gap-2 sm:flex-row">
                <Button as="label" variant="secondary" loading={logoUploading} loadingLabel="Uploading..." className="cursor-pointer">
                  <Upload size={16} /> Upload Logo
                  <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onLogoUpload} disabled={logoUploading || logoRemoving} />
                </Button>
                {general.logo_url && (
                  <Button type="button" variant="danger" onClick={onLogoRemove} loading={logoRemoving} loadingLabel="Removing..." disabled={logoUploading}>
                    <Trash2 size={16} /> Remove Logo
                  </Button>
                )}
              </div>
            </div>
          </div>
          <Textarea label="Welcome Message" value={general.welcome_message} onChange={event => onGeneralChange("welcome_message", event.target.value)} rows={3} required />
          <div className="space-y-4 rounded-lg border border-border bg-background-base p-4">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-base font-semibold text-text-primary">Login Page Content</h3>
                <p className="text-sm text-text-secondary">Controls the left panel copy shown before users sign in.</p>
              </div>
              <Badge variant="info">{enabledFeatureCount}/6 Features enabled</Badge>
            </div>
            <Input
              label="Heading"
              value={general.login_page_heading}
              onChange={event => onGeneralChange("login_page_heading", event.target.value)}
              placeholder="Exam Platform"
            />
            <Input
              label="Tagline"
              value={general.login_page_tagline}
              onChange={event => onGeneralChange("login_page_tagline", event.target.value)}
              placeholder="The future of secure, intelligent assessment."
            />
            <Input
              label="Description"
              value={general.login_page_subheading}
              onChange={event => onGeneralChange("login_page_subheading", event.target.value)}
              placeholder="Focused, secure, and ready for every exam session."
            />
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <label className="font-semibold text-text-primary">Feature Bullets</label>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={onAddLoginFeature}
                  disabled={general.login_page_features.length >= 6}
                >
                  <Plus size={15} /> Add Feature
                </Button>
              </div>
              <div className="space-y-2">
                {general.login_page_features.map((feature, index) => (
                  <div key={`login-feature-${index}`} className="grid gap-3 rounded-md border border-border bg-background-card p-3 lg:grid-cols-[auto_150px_minmax(0,1fr)_auto_auto] lg:items-center">
                    <GripVertical className="hidden text-text-muted lg:block" size={17} aria-hidden="true" />
                    <Select
                      aria-label={`Login feature ${index + 1} icon`}
                      value={feature.icon || "Shield"}
                      onChange={value => onUpdateLoginFeature(index, "icon", value)}
                      options={loginFeatureIconOptions}
                    />
                    <Input
                      aria-label={`Login feature ${index + 1}`}
                      value={feature.text || ""}
                      onChange={event => onUpdateLoginFeature(index, "text", event.target.value)}
                      placeholder="Feature text"
                    />
                    <Toggle
                      checked={feature.enabled !== false}
                      onChange={checked => onUpdateLoginFeature(index, "enabled", checked)}
                      label="Enabled"
                    />
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 w-11 px-0"
                        onClick={() => onMoveLoginFeature(index, -1)}
                        disabled={index === 0}
                        aria-label="Move feature up"
                      >
                        <ArrowUp size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 w-11 px-0"
                        onClick={() => onMoveLoginFeature(index, 1)}
                        disabled={index === general.login_page_features.length - 1}
                        aria-label="Move feature down"
                      >
                        <ArrowDown size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-11 w-11 px-0 text-danger hover:text-danger"
                        onClick={() => onRemoveLoginFeature(index)}
                        aria-label="Remove feature"
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid gap-3 rounded-lg border border-border bg-background-card p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
              <Input
                label="Security Badge Text"
                value={general.login_page_security_badge_text}
                onChange={event => onGeneralChange("login_page_security_badge_text", event.target.value)}
                placeholder="Secured by end-to-end encryption"
              />
              <Toggle
                checked={general.login_page_security_badge_enabled}
                onChange={checked => onGeneralChange("login_page_security_badge_enabled", checked)}
                label="Show badge"
              />
            </div>
            <div className="overflow-hidden rounded-xl border border-border bg-gradient-to-br from-brand-primary via-indigo-500 to-info p-5 text-white shadow-sm">
              <div className="mb-6 flex items-center gap-3">
                <PlatformLogo
                  src={general.logo_url}
                  name={general.platform_name}
                  size="sm"
                  className="border-white/25 bg-white/15"
                  fallbackClassName="bg-brand-primary"
                />
                <strong className="truncate text-lg">{general.platform_name || "Exam Platform"}</strong>
              </div>
              <h4 className="text-2xl font-bold leading-tight">{general.login_page_heading || "Exam Platform"}</h4>
              <p className="mt-3 text-sm font-light italic text-cyan-100/80">{general.login_page_tagline || "The future of secure, intelligent assessment."}</p>
              <p className="mt-3 text-sm text-white/85">
                {general.login_page_subheading || "Focused, secure, and ready for every exam session."}
              </p>
              <div className="mt-6 space-y-2 text-sm text-white/85">
                {(general.login_page_features.length ? general.login_page_features : defaultLoginFeatures).filter(feature => feature.enabled !== false && feature.text).map(feature => {
                  const Icon = loginFeatureIcons[feature.icon] || CheckCircle2;
                  return (
                  <p key={feature.text} className="flex items-center gap-2">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-white/20">
                      <Icon size={14} />
                    </span>
                    {feature.text}
                  </p>
                );})}
              </div>
              {general.login_page_security_badge_enabled && general.login_page_security_badge_text && (
                <p className="mt-5 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-cyan-50">
                  {general.login_page_security_badge_text}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-3">
            <label className="block font-semibold text-text-primary">Quote Pool</label>
            <div className="flex flex-wrap gap-2">
              {general.quote_pool.map((quote, index) => (
                <span key={`${quote}-${index}`} className="inline-flex min-h-10 items-center gap-2 rounded-pill border border-border bg-background-base px-3 text-sm text-text-primary">
                  {quote}
                  <button type="button" onClick={() => onRemoveQuote(index)} className="text-text-muted hover:text-danger" aria-label="Remove quote">
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
            <Input
              label="Add Quote"
              value={quoteDraft}
              onChange={event => onQuoteDraftChange(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onAddQuote();
                }
              }}
              placeholder="Type quote and press Enter"
            />
          </div>
        </div>
      </Card>
    );
  }

  if (sectionId === "registration") {
    return (
      <Card className="p-6">
        <div className="space-y-5">
          <h2 className="text-xl font-semibold text-text-primary">Registration</h2>
          <Toggle checked={registration.self_registration_enabled} onChange={checked => onRegistrationChange("self_registration_enabled", checked)} label="Allow student self-registration" />
          <Toggle checked={registration.registration_code_required} onChange={checked => onRegistrationChange("registration_code_required", checked)} label="Require registration code" />
          {registration.registration_code_required && (
            <Input label="Registration Code" value={registration.registration_code} onChange={event => onRegistrationChange("registration_code", event.target.value)} placeholder="e.g. EXAM2026" required />
          )}
        </div>
      </Card>
    );
  }

  if (sectionId === "security") {
    return (
      <Card className="p-6">
        <div className="space-y-5">
          <h2 className="text-xl font-semibold text-text-primary">Security</h2>
          <Input label="Violation Threshold" type="number" min="1" value={security.violation_threshold} onChange={event => onSecurityChange("violation_threshold", Number(event.target.value || 1))} required />
          <Input label="Admin Lockout Count" type="number" min="1" max="10" value={security.admin_lockout_count} onChange={event => onSecurityChange("admin_lockout_count", Number(event.target.value || 1))} helperText="Failed admin attempts before a 30-minute lockout." required />
          <Input label="Admin Idle Timeout" type="number" min="5" max="1440" value={security.admin_idle_timeout} onChange={event => onSecurityChange("admin_idle_timeout", Number(event.target.value || 5))} helperText="Minutes before an inactive admin session expires." required />
        </div>
      </Card>
    );
  }

  if (sectionId === "announcement") {
    return (
      <Card className="p-6">
        <div className="space-y-5">
          <h2 className="text-xl font-semibold text-text-primary">Announcement</h2>
          <Toggle checked={announcement.enabled} onChange={checked => onAnnouncementChange("enabled", checked)} label="Enable announcement" />
          {announcement.enabled && (
            <>
              <Textarea label="Announcement Message" value={announcement.message} onChange={event => onAnnouncementChange("message", event.target.value)} rows={4} required />
              <Card className="border-warning/30 bg-warning/5 p-4">
                <div className="flex items-start gap-3">
                  <Megaphone size={20} className="mt-1 shrink-0 text-warning" />
                  <p className="mb-0 text-sm text-text-secondary">{announcement.message || "Announcement preview"}</p>
                </div>
              </Card>
            </>
          )}
        </div>
      </Card>
    );
  }

  if (sectionId === "backup") {
    return (
      <Card className="p-6">
        <div className="space-y-5">
          <h2 className="text-xl font-semibold text-text-primary">Backup</h2>
          <div className="rounded-lg border border-border bg-background-base p-4">
            <p className="mb-0 text-sm text-text-secondary">Download a fresh backup whenever you need an offline copy.</p>
          </div>
          <form onSubmit={onBackup} className="space-y-3 rounded-lg border border-border bg-background-base p-4">
            <Input label="Admin Password" name="admin_password" type="password" value={backupPassword} onChange={event => onBackupPasswordChange(event.target.value)} autoComplete="current-password" required />
            <Button type="submit" variant="primary" loading={backupLoading} loadingLabel="Preparing...">
              <Download size={16} /> Download Backup
            </Button>
          </form>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-text-primary">Notifications</h2>
        <p className="text-sm text-text-secondary">In-app notifications are active for account, exam, result, and proctoring events.</p>
      </div>
    </Card>
  );
}
