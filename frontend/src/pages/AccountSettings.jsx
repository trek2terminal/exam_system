import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CalendarDays,
  Camera,
  Lock,
  LogOut,
  Save,
  ShieldCheck,
  Users
} from "lucide-react";
import { Badge, Button, Card, CropModal, Input, Toggle } from "../components/ui";
import { notify } from "../components/ui/Toast";
import { roleLabel, userName } from "../components/layout/navigation";
import { api } from "../services/api";
import { useAppStore } from "../store/appStore";
import { formatDate } from "../utils/dateFormat";

function passwordStrength(password) {
  if (!password) return null;
  const mixedCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  if (password.length >= 10 && mixedCase && hasNumber && hasSymbol) {
    return { label: "Strong", color: "bg-success", width: "100%" };
  }
  if (password.length >= 6) return { label: "Fair", color: "bg-warning", width: "60%" };
  return { label: "Weak", color: "bg-danger", width: "30%" };
}

function sectionLabel(children) {
  return <p className="mb-4 text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted">{children}</p>;
}

function identityStats(role, stats = {}) {
  if (role === "student") {
    return [
      ["Exams", stats.exams_taken || 0],
      ["Results", stats.results_available || 0],
      ["Batches", stats.batches_joined || 0]
    ];
  }
  if (role === "teacher") {
    return [
      ["Exams", stats.exams_created || 0],
      ["Batches", stats.active_batches || 0],
      ["Students", stats.students_taught || 0]
    ];
  }
  return [
    ["Teachers", stats.total_teachers || 0],
    ["Students", stats.total_students || 0],
    ["Exams", stats.exams_on_platform || 0]
  ];
}

function identityTheme(role) {
  if (role === "teacher") {
    return {
      banner: "from-info/25 via-background-surface to-background-base",
      avatar: "border-info bg-info shadow-info/20",
      dot: "bg-info",
      badge: "bg-info/10 text-info",
      stat: "text-info",
      button: "border-info/30 text-info hover:bg-info/10"
    };
  }
  if (role === "student") {
    return {
      banner: "from-success/25 via-background-surface to-background-base",
      avatar: "border-success bg-success shadow-success/20",
      dot: "bg-success",
      badge: "bg-success/10 text-success",
      stat: "text-success",
      button: "border-success/30 text-success hover:bg-success/10"
    };
  }
  return {
    banner: "from-brand-primary/30 via-background-surface to-background-base",
    avatar: "border-brand-primary bg-brand-primary shadow-brand-primary/20",
    dot: "bg-brand-primary",
    badge: "bg-brand-primary/10 text-brand-primary",
    stat: "text-brand-primary",
    button: "border-brand-primary/30 text-brand-primary hover:bg-brand-primary/10"
  };
}

function identityLine(role, user, profile) {
  if (role === "student") return `Roll No: ${profile.roll || user.roll_number || "-"}`;
  if (role === "teacher") return `ID: ${user.username || "-"}`;
  return `ID: ${user.username || "-"}`;
}

function initials(name = "") {
  return String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "U";
}

function IdentityAvatar({ name, src, className }) {
  return (
    <span
      className={`grid h-28 w-28 shrink-0 place-items-center overflow-hidden rounded-full border-4 text-4xl font-semibold text-white shadow-2xl ${className}`}
      aria-label={name || "User avatar"}
    >
      {src ? <img className="h-full w-full object-cover" src={src} alt="" /> : initials(name)}
    </span>
  );
}

export default function AccountSettings({ auth, mode = "settings" }) {
  const isProfile = mode === "profile";
  const loadBootstrap = useAppStore(state => state.loadBootstrap);
  const [account, setAccount] = useState({ stats: {}, details: {}, session: {}, preferences: {} });
  const [profile, setProfile] = useState({
    name: userName(auth),
    email: auth?.email || "",
    roll: auth?.roll_no || auth?.roll_number || "",
    avatar_url: auth?.profile_picture || ""
  });
  const [security, setSecurity] = useState({ current: "", next: "", confirm: "" });
  const [preferences, setPreferences] = useState({ exam_reminders: true, announcement_banners: true });
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [avatarCropSrc, setAvatarCropSrc] = useState("");
  const [avatarFileName, setAvatarFileName] = useState("profile-avatar.png");

  const strength = useMemo(() => passwordStrength(security.next), [security.next]);
  const canChangePassword = security.current && security.next && security.confirm && security.next === security.confirm;
  const role = auth?.role || account.user?.role;
  const user = account.user || {};
  const batchText = account.details?.batches?.length ? account.details.batches.join(", ") : user.batch || user.class_name || "Not assigned";
  const theme = identityTheme(role);

  useEffect(() => {
    let mounted = true;
    api.get("/account")
      .then(({ data }) => {
        if (!mounted) return;
        setAccount(data || {});
        setProfile(current => ({
          ...current,
          name: data.user?.name || current.name,
          email: data.user?.email || "",
          roll: data.user?.roll_number || auth?.roll_no || "",
          avatar_url: data.user?.profile_picture || current.avatar_url
        }));
        setPreferences({
          exam_reminders: data.preferences?.exam_reminders !== false,
          announcement_banners: data.preferences?.announcement_banners !== false
        });
      })
      .catch(error => notify.error(error.message || "Could not load account details"));
    return () => {
      mounted = false;
    };
  }, [auth?.roll_no]);

  useEffect(() => () => {
    if (avatarCropSrc) window.URL.revokeObjectURL(avatarCropSrc);
  }, [avatarCropSrc]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const { data } = await api.patch("/account/profile", {
        name: profile.name,
        email: profile.email
      });
      setProfile(current => ({
        ...current,
        name: data.user?.name || current.name,
        email: data.user?.email || current.email
      }));
      setAccount(current => ({ ...current, user: data.user || current.user }));
      await loadBootstrap();
      notify.success(data.message || "Profile updated");
    } catch (error) {
      notify.error(error.message || "Could not update profile");
    } finally {
      setSavingProfile(false);
    }
  };

  const clearAvatarCrop = () => {
    setAvatarCropSrc(current => {
      if (current) window.URL.revokeObjectURL(current);
      return "";
    });
  };

  const uploadAvatar = event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const allowedTypes = ["image/png", "image/jpeg"];
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!allowedTypes.includes(file.type) && !["png", "jpg", "jpeg"].includes(extension)) {
      notify.error("Profile image must be PNG or JPG.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      notify.error("Profile image must be 10 MB or smaller.");
      return;
    }
    setAvatarFileName(file.name.replace(/\.[^.]+$/, ".png") || "profile-avatar.png");
    setAvatarCropSrc(current => {
      if (current) window.URL.revokeObjectURL(current);
      return window.URL.createObjectURL(file);
    });
  };

  const uploadCroppedAvatar = async blob => {
    const formData = new window.FormData();
    formData.append("avatar", blob, avatarFileName);
    setUploadingAvatar(true);
    try {
      const { data } = await api.post("/account/avatar", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      setProfile(current => ({ ...current, avatar_url: data.user?.profile_picture || current.avatar_url }));
      setAccount(current => ({ ...current, user: data.user || current.user }));
      await loadBootstrap();
      notify.success(data.message || "Profile image uploaded");
      clearAvatarCrop();
    } catch (error) {
      notify.error(error.message || "Could not upload profile image");
    } finally {
      setUploadingAvatar(false);
    }
  };

  const changePassword = async () => {
    if (!canChangePassword) return;
    setChangingPassword(true);
    try {
      const { data } = await api.post("/account/password", {
        current_password: security.current,
        new_password: security.next,
        confirm_password: security.confirm
      });
      setSecurity({ current: "", next: "", confirm: "" });
      notify.success(data.message || "Password changed successfully");
    } catch (error) {
      notify.error(error.message || "Could not change password");
    } finally {
      setChangingPassword(false);
    }
  };

  const savePreferences = async () => {
    setSavingPreferences(true);
    try {
      const { data } = await api.patch("/account/preferences", preferences);
      setPreferences(data.preferences || preferences);
      notify.success(data.message || "Preferences saved");
    } catch (error) {
      notify.error(error.message || "Could not save preferences");
    } finally {
      setSavingPreferences(false);
    }
  };

  const deactivateAccount = async () => {
    if (!window.confirm("Deactivate this account? You will be signed out immediately.")) return;
    setDeactivating(true);
    try {
      const { data } = await api.post("/account/deactivate");
      notify.success(data.message || "Account deactivated");
      window.location.href = data.redirect || "/";
    } catch (error) {
      notify.error(error.message || "Could not deactivate account");
      setDeactivating(false);
    }
  };

  if (isProfile) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Profile</p>
          <h1 className="text-3xl font-bold text-text-primary">Your Profile</h1>
          <p className="mt-1 text-text-secondary">Identity details for your {roleLabel(role).toLowerCase()} workspace.</p>
        </div>

        <div className="grid gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
          <Card className="overflow-hidden text-center shadow-elevated">
            <div className={`relative h-32 border-b border-border/60 bg-gradient-to-br ${theme.banner}`}>
              <div className="absolute left-5 top-5 text-left">
                <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-muted">Profile Card</p>
                <p className="mt-1 text-sm font-semibold text-text-primary">{roleLabel(role)} Identity</p>
              </div>
            </div>
            <div className="-mt-14 flex justify-center">
              <div className="relative">
                <IdentityAvatar
                  name={profile.name}
                  src={profile.avatar_url}
                  className={theme.avatar}
                />
                <label
                  className={`absolute bottom-1 right-1 grid h-9 w-9 cursor-pointer place-items-center rounded-full border-[3px] border-background-card text-white shadow-lg transition hover:brightness-110 ${theme.dot}`}
                  aria-label="Change profile photo"
                >
                  <Camera size={16} strokeWidth={2.4} />
                  <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={uploadAvatar} disabled={uploadingAvatar} />
                </label>
              </div>
            </div>
            <div className="px-6 pb-6 pt-4">
              <h2 className="text-xl font-semibold text-text-primary">{profile.name || "Unnamed user"}</h2>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                <Badge className={theme.badge}>{roleLabel(role)}</Badge>
                <span className="rounded-pill border border-border bg-background-base px-2.5 py-1 text-xs font-semibold text-text-muted">
                  {identityLine(role, user, profile)}
                </span>
              </div>
              <p className="mt-3 text-xs text-text-muted">Member since {formatDate(user.created_at) || "Unknown"}</p>
              <div className="my-5 h-px bg-border/70" />
              <div className="grid grid-cols-3 gap-3">
                {identityStats(role, account.stats).map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-border bg-background-base px-2 py-3">
                    <span className={`block text-xl font-bold ${theme.stat}`}>{Number(value || 0).toLocaleString()}</span>
                    <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-text-muted">{label}</span>
                  </div>
                ))}
              </div>
              <Button as="label" variant="secondary" loading={uploadingAvatar} loadingLabel="Uploading" className={`mt-5 w-full cursor-pointer ${theme.button}`}>
                <Camera size={16} /> Change profile photo
                <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={uploadAvatar} disabled={uploadingAvatar} />
              </Button>
            </div>
          </Card>

          <Card className="p-6">
            {sectionLabel("Profile Details")}
            <div className="grid gap-4">
              <Input label="Full Name" value={profile.name} onChange={event => setProfile(current => ({ ...current, name: event.target.value }))} required />
              <Input
                label="Email"
                type="email"
                value={profile.email}
                onChange={event => setProfile(current => ({ ...current, email: event.target.value }))}
                disabled={role === "student"}
                helperText={role === "student" ? "Managed by school account" : undefined}
              />
              {role === "student" && (
                <>
                  <Input label="Roll Number" value={profile.roll || "-"} disabled />
                  <Input label="Class / Batch" value={batchText} disabled />
                </>
              )}
              {role === "teacher" && (
                <>
                  <Input label="Teacher ID" value={user.username || "-"} disabled />
                  <Input label="Subject / Department" value={user.department || user.designation || "Not assigned"} disabled />
                </>
              )}
              {role === "admin" && (
                <>
                  <Input label="Admin ID" value={user.username || "-"} disabled />
                  <Input label="Platform Role" value="Administrator" disabled />
                </>
              )}
              <Button variant="primary" onClick={saveProfile} loading={savingProfile} loadingLabel="Saving" className="w-full">
                <Save size={17} /> Save Profile
              </Button>
            </div>
          </Card>
        </div>

        <CropModal imageSrc={avatarCropSrc} aspectRatio={1} onConfirm={uploadCroppedAvatar} onCancel={clearAvatarCrop} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase text-text-muted">Settings</p>
        <h1 className="text-3xl font-bold text-text-primary">Account Settings</h1>
        <p className="mt-1 text-text-secondary">Security, notifications, session controls, and privacy preferences.</p>
      </div>

      <Card className="p-6">
        {sectionLabel("Security")}
        <div className="grid gap-4">
          <Input label="Current Password" type="password" value={security.current} onChange={event => setSecurity(current => ({ ...current, current: event.target.value }))} required />
          <Input label="New Password" type="password" value={security.next} onChange={event => setSecurity(current => ({ ...current, next: event.target.value }))} required />
          {strength && (
            <div>
              <div className="rounded-pill bg-background-elevated p-1">
                <div className={`h-2 rounded-pill ${strength.color} transition-all duration-300`} style={{ width: strength.width }} />
              </div>
              <p className="mt-2 text-sm font-semibold text-text-secondary">Strength: {strength.label}</p>
            </div>
          )}
          <Input
            label="Confirm New Password"
            type="password"
            value={security.confirm}
            onChange={event => setSecurity(current => ({ ...current, confirm: event.target.value }))}
            error={security.confirm && security.confirm !== security.next ? "Passwords do not match" : undefined}
            required
          />
          <Button variant="primary" disabled={!canChangePassword} loading={changingPassword} loadingLabel="Changing" onClick={changePassword}>
            <ShieldCheck size={17} /> Change Password
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        {sectionLabel("Notifications")}
        <div className="grid gap-4">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background-base p-4">
            <div className="flex items-center gap-3">
              <Bell size={20} className="text-brand-primary" />
              <span className="font-semibold text-text-primary">Receive exam reminders</span>
            </div>
            <Toggle checked={preferences.exam_reminders} onChange={checked => setPreferences(current => ({ ...current, exam_reminders: checked }))} />
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background-base p-4">
            <div className="flex items-center gap-3">
              <Users size={20} className="text-brand-primary" />
              <span className="font-semibold text-text-primary">Show announcement banners on dashboard</span>
            </div>
            <Toggle checked={preferences.announcement_banners} onChange={checked => setPreferences(current => ({ ...current, announcement_banners: checked }))} />
          </div>
          <Button variant="secondary" onClick={savePreferences} loading={savingPreferences} loadingLabel="Saving">
            <Save size={17} /> Save Preferences
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        {sectionLabel("Session & Privacy")}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-background-base p-4">
            <CalendarDays size={20} className="mb-3 text-brand-primary" />
            <p className="text-sm text-text-secondary">Last login</p>
            <strong className="text-text-primary">{formatDate(account.session?.last_login) || "Not available"}</strong>
          </div>
          <div className="rounded-lg border border-border bg-background-base p-4">
            <Lock size={20} className="mb-3 text-brand-primary" />
            <p className="text-sm text-text-secondary">Active sessions</p>
            <strong className="text-text-primary">{account.session?.active_sessions || 1}</strong>
          </div>
        </div>
        <Button as="a" href={`/${role || "student"}/logout`} variant="secondary" className="mt-4 border-danger/40 text-danger hover:bg-danger/10">
          <LogOut size={17} /> Log out of all devices
        </Button>
      </Card>

      {role !== "student" && (
        <Card className="border-danger/30 bg-danger/5 p-6">
          {sectionLabel("Danger Zone")}
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <AlertTriangle size={22} className="mt-1 shrink-0 text-danger" />
              <div>
                <h2 className="font-semibold text-text-primary">Deactivate my account</h2>
                <p className="text-sm text-text-secondary">This signs you out and prevents future access until an administrator reactivates the account.</p>
              </div>
            </div>
            <Button variant="secondary" className="border-danger/40 text-danger hover:bg-danger/10" loading={deactivating} loadingLabel="Deactivating" onClick={deactivateAccount}>
              Deactivate
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
