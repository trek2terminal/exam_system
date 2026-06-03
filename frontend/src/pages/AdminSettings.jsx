import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowDown, ArrowUp, BarChart2, Bell, BookOpen, CheckCircle2, Code2, DatabaseBackup, Download, GripVertical, Layers, Lock, Megaphone, Plus, Save, Shield, Settings2, ShieldCheck, Trash2, Upload, UserCheck, UserPlus, X, Zap } from "lucide-react";
import { Badge, Button, Card, CropModal, Input, PlatformLogo, Select, Textarea, Toggle } from "../components/ui";
import { notify } from "../components/ui/Toast";
import { api } from "../services/api";
import { useAppStore } from "../store/appStore";
import { useDraftAutoSave } from "../hooks/useDraftAutoSave";
import { clampInteger, integerInput } from "../utils/inputSanitizers";

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

const defaultLoginFormContent = {
  title: "Welcome back",
  subtitle: "Sign in to continue to your workspace",
  student_tab: "Student",
  teacher_tab: "Teacher",
  student_identifier_label: "Username, Email, or Roll Number",
  student_identifier_placeholder: "student@example.com",
  teacher_identifier_label: "Teacher Username",
  teacher_identifier_placeholder: "teacher.username",
  password_label: "Password",
  password_placeholder: "Password",
  submit_button: "Sign in",
  submitting: "Signing in...",
  student_register_prompt: "Do not have a student account?",
  student_register_link: "Create one",
  admin_link: "Admin sign in",
  session_conflict: "Another session on a different device has been signed out."
};

const defaultRegistrationPageContent = {
  account_title: "Create student account",
  account_subtitle: "Create your account to access assigned exams and results.",
  account_button: "Create Account",
  account_submitting: "Creating account...",
  sign_in_prompt: "Already have an account?",
  sign_in_link: "Sign in",
  loading_title: "Checking registration status",
  loading_subtitle: "We are preparing the right student access page for you.",
  paused_title: "Registration is paused for now",
  paused_subtitle: "Student self-registration is currently closed. Send your details to the admin and they can help you with access.",
  request_success: "Your message has reached the admin inbox.",
  request_message_label: "Message to Admin",
  request_message_placeholder: "Tell the admin which course, group, or exam access you need.",
  request_message_helper: "Minimum 10 characters",
  request_button: "Send Request to Admin",
  request_submitting: "Sending request...",
  request_footer: "The admin will see this in their notification inbox.",
  request_back_link: "Back to sign in"
};

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

function settingsRegistrationPageContent(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.entries(defaultRegistrationPageContent).reduce((result, [key, fallback]) => {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    const nextValue = source[key] ?? source[camelKey];
    result[key] = String(nextValue || fallback).trim() || fallback;
    return result;
  }, {});
}

function settingsLoginFormContent(value) {
  const source = value && typeof value === "object" ? value : {};
  return Object.entries(defaultLoginFormContent).reduce((result, [key, fallback]) => {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    const nextValue = source[key] ?? source[camelKey];
    result[key] = String(nextValue || fallback).trim() || fallback;
    return result;
  }, {});
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
    login_form_content: defaultLoginFormContent,
    registration_page_content: defaultRegistrationPageContent,
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
          login_form_content: settingsLoginFormContent(settings.login_form_content || settings.login_form),
          registration_page_content: settingsRegistrationPageContent(settings.registration_page_content || settings.registration_page),
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
        login_form_content: general.login_form_content,
        registration_page_content: general.registration_page_content,
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
    <div className="adminSettingsPage">
      <div className="settingsHero">
        <div className="settingsHeroCopy">
          <span className="settingsEyebrow">Administration</span>
          <h1>Platform Settings</h1>
          <p>Manage student registration, announcements, violation threshold, and database backup.</p>
        </div>
        <div className="settingsHeroActions">
          <Button className="settingsSaveButton" variant="primary" onClick={handleSave} loading={loading} loadingLabel="Saving..." disabled={!hasChanges}>
            <Save size={16} /> Save Changes
          </Button>
          {settingsDraft.indicator}
        </div>
      </div>

      <div className="settingsWorkspace">
        <Card className="settingsNavCard">
          <nav className="settingsNav" aria-label="Settings sections">
            {tabs.map(tab => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`settingsNavButton ${activeTab === tab.id ? "is-active" : ""}`}
                >
                  <span className="settingsNavIcon"><Icon size={18} /></span>
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </Card>

        <div className="settingsContent">
          {activeTab === "general" && <div className="settingsDraftBanner">{settingsDraft.banner}</div>}
          {renderSection(activeTab)}
        </div>

        <div className="settingsMobileStack">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const open = activeTab === tab.id;
            return (
              <div key={tab.id} className="settingsMobileCard">
                <button
                  type="button"
                  className="settingsMobileToggle"
                  onClick={() => setActiveTab(open ? "" : tab.id)}
                >
                  <span><Icon size={18} /> {tab.label}</span>
                  <span aria-hidden="true">{open ? "-" : "+"}</span>
                </button>
                {open && <div className="settingsMobileBody">{renderSection(tab.id)}</div>}
              </div>
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
    const loginFormCopy = settingsLoginFormContent(general.login_form_content);
    const updateLoginFormCopy = (field, value) => {
      onGeneralChange("login_form_content", { ...loginFormCopy, [field]: value });
    };
    const registrationCopy = settingsRegistrationPageContent(general.registration_page_content);
    const updateRegistrationCopy = (field, value) => {
      onGeneralChange("registration_page_content", { ...registrationCopy, [field]: value });
    };
    return (
      <Card className="settingsSectionCard settingsSectionCard--general">
        <div className="settingsSectionHeader">
          <span className="settingsSectionIcon"><Settings2 size={22} /></span>
          <div>
            <span className="settingsEyebrow">Platform identity</span>
            <h2>General</h2>
            <p>Brand the workspace, login screen, registration experience, and welcome copy.</p>
          </div>
        </div>
        <div className="settingsSectionBody">
          <Input label="Platform Name" value={general.platform_name} onChange={event => onGeneralChange("platform_name", event.target.value)} required />
          <div className="settingsLogoField">
            <label>Logo</label>
            <div className="settingsLogoDrop">
              <PlatformLogo
                src={general.logo_url}
                name={general.platform_name}
                size="lg"
                className="settingsLogoPreview"
                fallbackClassName="bg-brand-primary"
              />
              <p>Upload a PNG, JPG, WEBP, or GIF logo up to 2 MB.</p>
              <div className="settingsLogoActions">
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
          <div className="settingsSubPanel settingsSubPanel--login">
            <div className="settingsSubHeader">
              <div>
                <span className="settingsEyebrow">Public login</span>
                <h3>Login Page Content</h3>
                <p>Controls the left panel copy shown before users sign in.</p>
              </div>
              <Badge className="settingsCountBadge" variant="info">{enabledFeatureCount}/6 Features enabled</Badge>
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
            <div className="settingsFeaturePanel">
              <div className="settingsFeatureHeader">
                <label>Feature Bullets</label>
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
              <div className="settingsFeatureList">
                {general.login_page_features.map((feature, index) => (
                  <div key={`login-feature-${index}`} className="settingsFeatureRow">
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
            <div className="settingsInlinePanel">
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
            <div className="settingsLoginPreview">
              <div className="settingsLoginPreviewBrand">
                <PlatformLogo
                  src={general.logo_url}
                  name={general.platform_name}
                  size="sm"
                  className="border-white/25 bg-white/15"
                  fallbackClassName="bg-brand-primary"
                />
                <strong className="truncate text-lg">{general.platform_name || "Exam Platform"}</strong>
              </div>
              <h4>{general.login_page_heading || "Exam Platform"}</h4>
              <p className="settingsLoginPreviewTagline">{general.login_page_tagline || "The future of secure, intelligent assessment."}</p>
              <p className="settingsLoginPreviewCopy">
                {general.login_page_subheading || "Focused, secure, and ready for every exam session."}
              </p>
              <div className="settingsLoginPreviewFeatures">
                {(general.login_page_features.length ? general.login_page_features : defaultLoginFeatures).filter(feature => feature.enabled !== false && feature.text).map(feature => {
                  const Icon = loginFeatureIcons[feature.icon] || CheckCircle2;
                  return (
                  <p key={feature.text}>
                    <span>
                      <Icon size={14} />
                    </span>
                    {feature.text}
                  </p>
                );})}
              </div>
              {general.login_page_security_badge_enabled && general.login_page_security_badge_text && (
                <p className="settingsLoginPreviewBadge">
                  {general.login_page_security_badge_text}
                </p>
              )}
            </div>
          </div>
          <div className="settingsSubPanel">
            <div className="settingsSubHeader">
              <div>
                <span className="settingsEyebrow">Sign-in card</span>
                <h3>Login Form Copy</h3>
                <p>Controls the sign-in card text, tabs, labels, buttons, and links.</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Form Title"
                value={loginFormCopy.title}
                onChange={event => updateLoginFormCopy("title", event.target.value)}
              />
              <Input
                label="Form Subtitle"
                value={loginFormCopy.subtitle}
                onChange={event => updateLoginFormCopy("subtitle", event.target.value)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Student Tab"
                value={loginFormCopy.student_tab}
                onChange={event => updateLoginFormCopy("student_tab", event.target.value)}
              />
              <Input
                label="Teacher Tab"
                value={loginFormCopy.teacher_tab}
                onChange={event => updateLoginFormCopy("teacher_tab", event.target.value)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Student Identifier Label"
                value={loginFormCopy.student_identifier_label}
                onChange={event => updateLoginFormCopy("student_identifier_label", event.target.value)}
              />
              <Input
                label="Student Identifier Placeholder"
                value={loginFormCopy.student_identifier_placeholder}
                onChange={event => updateLoginFormCopy("student_identifier_placeholder", event.target.value)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Teacher Identifier Label"
                value={loginFormCopy.teacher_identifier_label}
                onChange={event => updateLoginFormCopy("teacher_identifier_label", event.target.value)}
              />
              <Input
                label="Teacher Identifier Placeholder"
                value={loginFormCopy.teacher_identifier_placeholder}
                onChange={event => updateLoginFormCopy("teacher_identifier_placeholder", event.target.value)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Password Label"
                value={loginFormCopy.password_label}
                onChange={event => updateLoginFormCopy("password_label", event.target.value)}
              />
              <Input
                label="Password Placeholder"
                value={loginFormCopy.password_placeholder}
                onChange={event => updateLoginFormCopy("password_placeholder", event.target.value)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Submit Button"
                value={loginFormCopy.submit_button}
                onChange={event => updateLoginFormCopy("submit_button", event.target.value)}
              />
              <Input
                label="Submitting Label"
                value={loginFormCopy.submitting}
                onChange={event => updateLoginFormCopy("submitting", event.target.value)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Student Account Prompt"
                value={loginFormCopy.student_register_prompt}
                onChange={event => updateLoginFormCopy("student_register_prompt", event.target.value)}
              />
              <Input
                label="Student Account Link"
                value={loginFormCopy.student_register_link}
                onChange={event => updateLoginFormCopy("student_register_link", event.target.value)}
              />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Admin Link"
                value={loginFormCopy.admin_link}
                onChange={event => updateLoginFormCopy("admin_link", event.target.value)}
              />
              <Input
                label="Session Conflict Notice"
                value={loginFormCopy.session_conflict}
                onChange={event => updateLoginFormCopy("session_conflict", event.target.value)}
              />
            </div>
          </div>
          <div className="settingsSubPanel">
            <div className="settingsSubHeader">
              <div>
                <span className="settingsEyebrow">Student onboarding</span>
                <h3>Registration Page Copy</h3>
                <p>Controls the create-account and paused-registration panels.</p>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Account Form Title"
                value={registrationCopy.account_title}
                onChange={event => updateRegistrationCopy("account_title", event.target.value)}
              />
              <Input
                label="Account Button"
                value={registrationCopy.account_button}
                onChange={event => updateRegistrationCopy("account_button", event.target.value)}
              />
            </div>
            <Textarea
              label="Account Form Subtitle"
              value={registrationCopy.account_subtitle}
              onChange={event => updateRegistrationCopy("account_subtitle", event.target.value)}
              rows={2}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Submitting Label"
                value={registrationCopy.account_submitting}
                onChange={event => updateRegistrationCopy("account_submitting", event.target.value)}
              />
              <Input
                label="Sign-In Link"
                value={registrationCopy.sign_in_link}
                onChange={event => updateRegistrationCopy("sign_in_link", event.target.value)}
              />
            </div>
            <Input
              label="Sign-In Prompt"
              value={registrationCopy.sign_in_prompt}
              onChange={event => updateRegistrationCopy("sign_in_prompt", event.target.value)}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Loading Title"
                value={registrationCopy.loading_title}
                onChange={event => updateRegistrationCopy("loading_title", event.target.value)}
              />
              <Input
                label="Paused Title"
                value={registrationCopy.paused_title}
                onChange={event => updateRegistrationCopy("paused_title", event.target.value)}
              />
            </div>
            <Textarea
              label="Loading Subtitle"
              value={registrationCopy.loading_subtitle}
              onChange={event => updateRegistrationCopy("loading_subtitle", event.target.value)}
              rows={2}
            />
            <Textarea
              label="Paused Subtitle"
              value={registrationCopy.paused_subtitle}
              onChange={event => updateRegistrationCopy("paused_subtitle", event.target.value)}
              rows={2}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Request Button"
                value={registrationCopy.request_button}
                onChange={event => updateRegistrationCopy("request_button", event.target.value)}
              />
              <Input
                label="Request Sending Label"
                value={registrationCopy.request_submitting}
                onChange={event => updateRegistrationCopy("request_submitting", event.target.value)}
              />
            </div>
            <Input
              label="Request Success Message"
              value={registrationCopy.request_success}
              onChange={event => updateRegistrationCopy("request_success", event.target.value)}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Message Field Label"
                value={registrationCopy.request_message_label}
                onChange={event => updateRegistrationCopy("request_message_label", event.target.value)}
              />
              <Input
                label="Message Helper"
                value={registrationCopy.request_message_helper}
                onChange={event => updateRegistrationCopy("request_message_helper", event.target.value)}
              />
            </div>
            <Textarea
              label="Message Placeholder"
              value={registrationCopy.request_message_placeholder}
              onChange={event => updateRegistrationCopy("request_message_placeholder", event.target.value)}
              rows={2}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label="Request Footer"
                value={registrationCopy.request_footer}
                onChange={event => updateRegistrationCopy("request_footer", event.target.value)}
              />
              <Input
                label="Paused Back Link"
                value={registrationCopy.request_back_link}
                onChange={event => updateRegistrationCopy("request_back_link", event.target.value)}
              />
            </div>
          </div>
          <div className="settingsQuotePanel">
            <div className="settingsSubHeader">
              <div>
                <span className="settingsEyebrow">Rotating copy</span>
                <h3>Quote Pool</h3>
                <p>Short login-page quotes that keep the experience fresh.</p>
              </div>
              <Badge variant="purple">{general.quote_pool.length} quotes</Badge>
            </div>
            <div className="settingsQuoteList">
              {general.quote_pool.map((quote, index) => (
                <span key={`${quote}-${index}`} className="settingsQuoteChip">
                  {quote}
                  <button type="button" onClick={() => onRemoveQuote(index)} aria-label="Remove quote">
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
      <Card className="settingsSectionCard settingsSectionCard--registration">
        <div className="settingsSectionHeader">
          <span className="settingsSectionIcon"><UserPlus size={22} /></span>
          <div>
            <span className="settingsEyebrow">Student access</span>
            <h2>Registration</h2>
            <p>Control who can create accounts and whether a join code is required.</p>
          </div>
        </div>
        <div className="settingsSectionBody">
          <div className="settingsToggleGrid">
            <Toggle checked={registration.self_registration_enabled} onChange={checked => onRegistrationChange("self_registration_enabled", checked)} label="Allow student self-registration" />
            <Toggle checked={registration.registration_code_required} onChange={checked => onRegistrationChange("registration_code_required", checked)} label="Require registration code" />
          </div>
          {registration.registration_code_required && (
            <div className="settingsSubPanel settingsSubPanel--compact">
              <Input label="Registration Code" value={registration.registration_code} onChange={event => onRegistrationChange("registration_code", event.target.value)} placeholder="e.g. EXAM2026" required />
            </div>
          )}
        </div>
      </Card>
    );
  }

  if (sectionId === "security") {
    return (
      <Card className="settingsSectionCard settingsSectionCard--security">
        <div className="settingsSectionHeader">
          <span className="settingsSectionIcon"><ShieldCheck size={22} /></span>
          <div>
            <span className="settingsEyebrow">Protection rules</span>
            <h2>Security</h2>
            <p>Set alert limits, lockout rules, and admin session timeout windows.</p>
          </div>
        </div>
        <div className="settingsSectionBody settingsFieldGrid">
          <Input label="Violation Threshold" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={security.violation_threshold} onChange={event => onSecurityChange("violation_threshold", clampInteger(integerInput(event.target.value, 2), 1, 10, 1))} required />
          <Input label="Admin Lockout Count" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} value={security.admin_lockout_count} onChange={event => onSecurityChange("admin_lockout_count", clampInteger(integerInput(event.target.value, 2), 1, 10, 1))} helperText="Failed admin attempts before a 30-minute lockout." required />
          <Input label="Admin Idle Timeout" type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={security.admin_idle_timeout} onChange={event => onSecurityChange("admin_idle_timeout", clampInteger(integerInput(event.target.value, 4), 5, 1440, 5))} helperText="Minutes before an inactive admin session expires." required />
        </div>
      </Card>
    );
  }

  if (sectionId === "announcement") {
    return (
      <Card className="settingsSectionCard settingsSectionCard--announcement">
        <div className="settingsSectionHeader">
          <span className="settingsSectionIcon"><Megaphone size={22} /></span>
          <div>
            <span className="settingsEyebrow">Broadcast banner</span>
            <h2>Announcement</h2>
            <p>Show a short message across the platform for students and teachers.</p>
          </div>
        </div>
        <div className="settingsSectionBody">
          <div className="settingsToggleGrid">
            <Toggle checked={announcement.enabled} onChange={checked => onAnnouncementChange("enabled", checked)} label="Enable announcement" />
          </div>
          {announcement.enabled && (
            <>
              <Textarea label="Announcement Message" value={announcement.message} onChange={event => onAnnouncementChange("message", event.target.value)} rows={4} required />
              <Card className="settingsPreviewNotice">
                <div>
                  <Megaphone size={20} />
                  <p>{announcement.message || "Announcement preview"}</p>
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
      <Card className="settingsSectionCard settingsSectionCard--backup">
        <div className="settingsSectionHeader">
          <span className="settingsSectionIcon"><DatabaseBackup size={22} /></span>
          <div>
            <span className="settingsEyebrow">Database export</span>
            <h2>Backup</h2>
            <p>Download a protected offline copy of the current platform database.</p>
          </div>
        </div>
        <div className="settingsSectionBody">
          <div className="settingsInfoPanel">
            <DatabaseBackup size={20} />
            <p>Download a fresh backup whenever you need an offline copy.</p>
          </div>
          <form onSubmit={onBackup} className="settingsBackupForm">
            <Input label="Admin Password" name="admin_password" type="password" value={backupPassword} onChange={event => onBackupPasswordChange(event.target.value)} autoComplete="current-password" required />
            <Button className="settingsBackupButton" type="submit" variant="primary" loading={backupLoading} loadingLabel="Preparing...">
              <Download size={16} /> Download Backup
            </Button>
          </form>
        </div>
      </Card>
    );
  }

  return (
    <Card className="settingsSectionCard settingsSectionCard--notifications">
      <div className="settingsSectionHeader">
        <span className="settingsSectionIcon"><Bell size={22} /></span>
        <div>
          <span className="settingsEyebrow">Activity alerts</span>
          <h2>Notifications</h2>
          <p>In-app notifications are active for account, exam, result, and proctoring events.</p>
        </div>
      </div>
      <div className="settingsSectionBody">
        <div className="settingsInfoPanel settingsInfoPanel--success">
          <CheckCircle2 size={20} />
          <p>Notification routing is enabled and ready for platform events.</p>
        </div>
      </div>
    </Card>
  );
}
