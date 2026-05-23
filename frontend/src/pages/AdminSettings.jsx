import { useEffect, useState } from "react";
import { Bell, DatabaseBackup, Download, Megaphone, Save, Settings2, ShieldCheck, Upload, UserPlus, X } from "lucide-react";
import { Button, Card, Input, Select, Textarea, Toggle } from "../components/ui";
import { notify } from "../components/ui/Toast";
import { api } from "../services/api";

const tabs = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "registration", label: "Registration", icon: UserPlus },
  { id: "security", label: "Security", icon: ShieldCheck },
  { id: "announcement", label: "Announcement", icon: Megaphone },
  { id: "backup", label: "Backup", icon: DatabaseBackup },
  { id: "notifications", label: "Notifications", icon: Bell }
];

export default function AdminSettings() {
  const [activeTab, setActiveTab] = useState("general");
  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [backupPassword, setBackupPassword] = useState("");
  const [quoteDraft, setQuoteDraft] = useState("");

  const [general, setGeneral] = useState({
    platform_name: "Exam Platform",
    logo_url: "",
    welcome_message: "Welcome to the Exam Platform",
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
        const { data } = await api.get("/bootstrap");
        const settings = data.settings || {};
        setGeneral(current => ({
          ...current,
          platform_name: settings.platform_name || current.platform_name,
          welcome_message: settings.welcome_message || current.welcome_message
        }));
        setRegistration(current => ({
          ...current,
          self_registration_enabled: Boolean(settings.student_self_registration)
        }));
        setSecurity(current => ({
          ...current,
          violation_threshold: Number(settings.max_violations_before_alert || current.violation_threshold)
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

  const markChanged = setter => (field, value) => {
    setter(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleGeneralChange = markChanged(setGeneral);
  const handleRegistrationChange = markChanged(setRegistration);
  const handleSecurityChange = markChanged(setSecurity);
  const handleAnnouncementChange = markChanged(setAnnouncement);

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

  const handleSave = async () => {
    setLoading(true);
    try {
      const formData = new window.FormData();
      formData.append("platform_name", general.platform_name);
      formData.append("welcome_message", general.welcome_message);
      formData.append("announcement_message", announcement.enabled ? announcement.message : "");
      formData.append("quote_pool", general.quote_pool.join("\n"));
      formData.append("max_violations_before_alert", String(security.violation_threshold));
      if (registration.self_registration_enabled) formData.append("student_self_registration", "on");

      const response = await window.fetch("/admin/settings/save", {
        method: "POST",
        body: formData,
        credentials: "same-origin"
      });
      if (!response.ok) throw new Error("Settings save failed");
      notify.success("Settings saved successfully");
      setHasChanges(false);
    } catch {
      notify.error("Failed to save settings");
    } finally {
      setLoading(false);
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
        <Button variant="primary" onClick={handleSave} loading={loading} loadingLabel="Saving..." disabled={!hasChanges}>
          <Save size={16} /> Save Changes
        </Button>
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
  onRemoveQuote
}) {
  if (sectionId === "general") {
    return (
      <Card className="p-6">
        <div className="space-y-5">
          <h2 className="text-xl font-semibold text-text-primary">General</h2>
          <Input label="Platform Name" value={general.platform_name} onChange={event => onGeneralChange("platform_name", event.target.value)} />
          <div>
            <label className="mb-3 block font-semibold text-text-primary">Logo</label>
            <div className="rounded-lg border-2 border-dashed border-border bg-background-base p-6 text-center">
              {general.logo_url ? <img src={general.logo_url} alt="Logo" className="mx-auto mb-3 h-16" /> : <Upload size={32} className="mx-auto mb-3 text-text-muted" />}
              <p className="mb-3 text-sm text-text-secondary">Logo upload is available on the classic settings/storage path when configured.</p>
              <input type="file" accept="image/*" className="hidden" />
            </div>
          </div>
          <Textarea label="Welcome Message" value={general.welcome_message} onChange={event => onGeneralChange("welcome_message", event.target.value)} rows={3} />
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
            <Input label="Registration Code" value={registration.registration_code} onChange={event => onRegistrationChange("registration_code", event.target.value)} placeholder="e.g. EXAM2026" />
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
          <Input label="Violation Threshold" type="number" min="1" value={security.violation_threshold} onChange={event => onSecurityChange("violation_threshold", Number(event.target.value || 1))} />
          <Input label="Admin Lockout Count" type="number" min="1" value={security.admin_lockout_count} onChange={event => onSecurityChange("admin_lockout_count", Number(event.target.value || 1))} helperText="This is runtime/env governed in the current Flask app." />
          <Input label="Admin Idle Timeout" type="number" min="5" value={security.admin_idle_timeout} onChange={event => onSecurityChange("admin_idle_timeout", Number(event.target.value || 5))} helperText="Minutes. This is runtime/env governed in the current Flask app." />
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
              <Textarea label="Announcement Message" value={announcement.message} onChange={event => onAnnouncementChange("message", event.target.value)} rows={4} />
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
            <p className="mb-0 text-sm text-text-secondary">Last backup timestamp is recorded by the server after a download is generated.</p>
          </div>
          <form method="post" action="/admin/settings/backup" className="space-y-3 rounded-lg border border-border bg-background-base p-4">
            <Input label="Admin Password" name="admin_password" type="password" value={backupPassword} onChange={event => onBackupPasswordChange(event.target.value)} autoComplete="current-password" required />
            <Button type="submit" variant="primary">
              <Download size={16} /> Download Backup
            </Button>
          </form>
          <Select
            label="Backup Frequency"
            value="manual"
            options={[{ value: "manual", label: "Manual" }]}
            disabled
            helperText="Scheduled backup frequency is not exposed by the current Flask settings endpoint."
          />
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-6">
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-text-primary">Notifications</h2>
        <p className="text-sm text-text-secondary">In-app notification records are enabled. Email transport settings are not exposed by the current Flask settings endpoint.</p>
      </div>
    </Card>
  );
}
