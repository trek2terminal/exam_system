import { useState } from "react";
import { Download, Save, Upload } from "lucide-react";
import { Button, Card, Input, Select, Textarea } from "../components/ui";
import { notify } from "../components/ui/Toast";

export default function AdminSettings() {
  const [activeTab, setActiveTab] = useState("general");
  const [loading, setLoading] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [backupPassword, setBackupPassword] = useState("");

  // General Settings
  const [general, setGeneral] = useState({
    platform_name: "Exam Platform",
    logo_url: "",
    welcome_message: "Welcome to the Exam Platform",
    quote_pool: [
      "One calm question at a time.",
      "Focus brings success.",
      "You've prepared well, now show it."
    ]
  });

  // Registration Settings
  const [registration, setRegistration] = useState({
    self_registration_enabled: true,
    registration_code_required: false,
    registration_code: "EXAM2024"
  });

  // Security Settings
  const [security, setSecurity] = useState({
    violation_threshold: 3,
    admin_lockout_count: 5,
    admin_idle_timeout: 30
  });

  // Announcement Settings
  const [announcement, setAnnouncement] = useState({
    enabled: true,
    message: "Welcome to the exam platform. Please read all instructions carefully."
  });

  // Backup Settings
  const [backup] = useState({
    last_backup: "2024-05-23 14:30",
    auto_backup_enabled: true,
    backup_frequency: "daily"
  });

  const tabs = [
    { id: "general", label: "General" },
    { id: "registration", label: "Registration" },
    { id: "security", label: "Security" },
    { id: "announcement", label: "Announcement" },
    { id: "backup", label: "Backup" },
    { id: "notifications", label: "Notifications" }
  ];

  const handleSave = async () => {
    setLoading(true);
    try {
      const formData = new window.FormData();
      formData.append("platform_name", general.platform_name);
      formData.append("welcome_message", general.welcome_message);
      formData.append("announcement_message", announcement.enabled ? announcement.message : "");
      formData.append("quote_pool", general.quote_pool.join("\n"));
      formData.append("max_violations_before_alert", String(security.violation_threshold));
      if (registration.self_registration_enabled) {
        formData.append("student_self_registration", "on");
      }

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

  const handleGeneralChange = (field, value) => {
    setGeneral(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleRegistrationChange = (field, value) => {
    setRegistration(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleSecurityChange = (field, value) => {
    setSecurity(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleAnnouncementChange = (field, value) => {
    setAnnouncement(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-text-muted">ADMINISTRATION</p>
          <h1 className="text-3xl font-bold text-text-primary">Platform Settings</h1>
        </div>
        {hasChanges && (
          <Button
            variant="primary"
            size="md"
            onClick={handleSave}
            loading={loading}
            loadingLabel="Saving..."
          >
            <Save size={16} /> Save Changes
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 font-semibold transition whitespace-nowrap ${
              activeTab === tab.id
                ? "border-b-2 border-brand-primary text-brand-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="max-w-2xl">
        {activeTab === "general" && (
          <div className="space-y-6">
            <Card className="p-6 space-y-5">
              <h3 className="font-semibold text-text-primary text-lg">General Settings</h3>

              <Input
                label="Platform Name"
                value={general.platform_name}
                onChange={e => handleGeneralChange("platform_name", e.target.value)}
              />

              <div>
                <label className="block font-semibold text-text-primary mb-3">Logo</label>
                <div className="rounded-lg border-2 border-dashed border-border bg-background-elevated/50 p-6 text-center">
                  {general.logo_url ? (
                    <img src={general.logo_url} alt="Logo" className="h-16 mx-auto mb-3" />
                  ) : (
                    <Upload size={32} className="mx-auto mb-3 text-text-muted" />
                  )}
                  <p className="text-sm text-text-secondary mb-3">Click to upload or drag and drop</p>
                  <input type="file" accept="image/*" className="hidden" />
                </div>
              </div>

              <Textarea
                label="Welcome Message"
                value={general.welcome_message}
                onChange={e => handleGeneralChange("welcome_message", e.target.value)}
                rows={3}
              />

              <div>
                <label className="block font-semibold text-text-primary mb-3">Quote Pool</label>
                <div className="space-y-2">
                  {general.quote_pool.map((quote, index) => (
                    <Input
                      key={index}
                      value={quote}
                      onChange={e => {
                        const newQuotes = [...general.quote_pool];
                        newQuotes[index] = e.target.value;
                        handleGeneralChange("quote_pool", newQuotes);
                      }}
                      placeholder={`Quote ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
            </Card>
          </div>
        )}

        {activeTab === "registration" && (
          <div className="space-y-6">
            <Card className="p-6 space-y-5">
              <h3 className="font-semibold text-text-primary text-lg">Registration Settings</h3>

              <div className="flex items-center justify-between">
                <label className="font-semibold text-text-primary">Allow Self-Registration</label>
                <Toggle
                  checked={registration.self_registration_enabled}
                  onChange={e => handleRegistrationChange("self_registration_enabled", e.target.checked)}
                />
              </div>

              <div className="flex items-center justify-between">
                <label className="font-semibold text-text-primary">Require Registration Code</label>
                <Toggle
                  checked={registration.registration_code_required}
                  onChange={e => handleRegistrationChange("registration_code_required", e.target.checked)}
                />
              </div>

              {registration.registration_code_required && (
                <Input
                  label="Registration Code"
                  value={registration.registration_code}
                  onChange={e => handleRegistrationChange("registration_code", e.target.value)}
                  placeholder="e.g., EXAM2024"
                />
              )}
            </Card>
          </div>
        )}

        {activeTab === "security" && (
          <div className="space-y-6">
            <Card className="p-6 space-y-5">
              <h3 className="font-semibold text-text-primary text-lg">Security Settings</h3>

              <Input
                label="Violation Threshold (max violations)"
                type="number"
                min="1"
                value={security.violation_threshold}
                onChange={e => handleSecurityChange("violation_threshold", parseInt(e.target.value))}
              />

              <Input
                label="Admin Lockout Count (failed attempts)"
                type="number"
                min="1"
                value={security.admin_lockout_count}
                onChange={e => handleSecurityChange("admin_lockout_count", parseInt(e.target.value))}
              />

              <Input
                label="Admin Idle Timeout (minutes)"
                type="number"
                min="5"
                value={security.admin_idle_timeout}
                onChange={e => handleSecurityChange("admin_idle_timeout", parseInt(e.target.value))}
              />
            </Card>
          </div>
        )}

        {activeTab === "announcement" && (
          <div className="space-y-6">
            <Card className="p-6 space-y-5">
              <h3 className="font-semibold text-text-primary text-lg">Announcement Settings</h3>

              <div className="flex items-center justify-between">
                <label className="font-semibold text-text-primary">Enable Announcement</label>
                <Toggle
                  checked={announcement.enabled}
                  onChange={e => handleAnnouncementChange("enabled", e.target.checked)}
                />
              </div>

              {announcement.enabled && (
                <>
                  <Textarea
                    label="Announcement Message"
                    value={announcement.message}
                    onChange={e => handleAnnouncementChange("message", e.target.value)}
                    rows={4}
                  />

                  <Card className="p-4 border-brand-primary/30 bg-brand-primary/5">
                    <p className="text-xs font-semibold text-brand-primary mb-2">PREVIEW</p>
                    <div className="rounded-lg bg-warning/5 border border-warning/30 p-4 flex items-start gap-3">
                      <span className="text-lg">📢</span>
                      <p className="text-sm text-text-secondary">{announcement.message}</p>
                    </div>
                  </Card>
                </>
              )}
            </Card>
          </div>
        )}

        {activeTab === "backup" && (
          <div className="space-y-6">
            <Card className="p-6 space-y-5">
              <h3 className="font-semibold text-text-primary text-lg">Backup Settings</h3>

              <div className="rounded-lg border border-border bg-background-elevated/50 p-4">
                <p className="text-sm text-text-secondary">Last Backup</p>
                <p className="text-lg font-semibold text-text-primary">{backup.last_backup}</p>
              </div>

              <form method="post" action="/admin/settings/backup" className="space-y-3 rounded-lg border border-border/50 bg-background-elevated/30 p-4">
                <Input
                  label="Admin Password"
                  name="admin_password"
                  type="password"
                  value={backupPassword}
                  onChange={event => setBackupPassword(event.target.value)}
                  placeholder="Required for database backup"
                  autoComplete="current-password"
                />
                <Button type="submit" variant="primary" size="md">
                  <Download size={16} /> Download Backup Now
                </Button>
              </form>

              <div className="flex items-center justify-between">
                <label className="font-semibold text-text-primary">Auto-Backup Enabled</label>
                <Toggle checked={backup.auto_backup_enabled} disabled />
              </div>

              <Select
                label="Backup Frequency"
                value={backup.backup_frequency}
                options={[
                  { value: "hourly", label: "Hourly" },
                  { value: "daily", label: "Daily" },
                  { value: "weekly", label: "Weekly" },
                  { value: "monthly", label: "Monthly" }
                ]}
                disabled
              />
            </Card>
          </div>
        )}

        {activeTab === "notifications" && (
          <div className="space-y-6">
            <Card className="p-6 space-y-5">
              <h3 className="font-semibold text-text-primary text-lg">Notification Settings</h3>

              <div className="rounded-lg border border-border/50 bg-background-elevated/30 p-4 text-center">
                <p className="text-sm text-text-muted">Email notification configuration is available in the system administration panel.</p>
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="sr-only peer"
      />
      <div className="w-11 h-6 bg-background-elevated rounded-pill peer peer-checked:bg-brand-primary peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all" />
    </label>
  );
}

