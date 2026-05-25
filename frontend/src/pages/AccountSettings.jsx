import { useEffect, useMemo, useState } from "react";
import { Lock, Save, ShieldCheck, Type, Upload, UserRound } from "lucide-react";
import { Avatar, Button, Card, CropModal, Input, Toggle } from "../components/ui";
import { notify } from "../components/ui/Toast";
import { roleLabel, userName } from "../components/layout/navigation";
import { api } from "../services/api";
import { useAppStore } from "../store/appStore";

function passwordStrength(password) {
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password)
  ];
  const score = checks.filter(Boolean).length;
  if (score <= 1) return { label: "Weak", color: "bg-danger", width: "25%" };
  if (score === 2) return { label: "Fair", color: "bg-warning", width: "50%" };
  if (score === 3) return { label: "Good", color: "bg-info", width: "75%" };
  return { label: "Strong", color: "bg-success", width: "100%" };
}

export default function AccountSettings({ auth }) {
  const loadBootstrap = useAppStore(state => state.loadBootstrap);
  const [profile, setProfile] = useState({
    name: userName(auth),
    email: auth?.email || "",
    roll: auth?.roll_no || "",
    avatar_url: auth?.profile_picture || ""
  });
  const [security, setSecurity] = useState({
    current: "",
    next: "",
    confirm: ""
  });
  const [fontSize, setFontSize] = useState(() => window.localStorage.getItem("examFontSize") || "medium");
  const [highContrast, setHighContrast] = useState(() => window.localStorage.getItem("examHighContrast") === "true");
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [avatarCropSrc, setAvatarCropSrc] = useState("");
  const [avatarFileName, setAvatarFileName] = useState("profile-avatar.png");

  const strength = useMemo(() => passwordStrength(security.next), [security.next]);

  useEffect(() => {
    document.documentElement.classList.remove("font-small", "font-medium", "font-large");
    document.documentElement.classList.add(`font-${fontSize}`);
    window.localStorage.setItem("examFontSize", fontSize);
  }, [fontSize]);

  useEffect(() => {
    document.documentElement.classList.toggle("high-contrast", highContrast);
    window.localStorage.setItem("examHighContrast", String(highContrast));
  }, [highContrast]);

  useEffect(() => () => {
    if (avatarCropSrc) window.URL.revokeObjectURL(avatarCropSrc);
  }, [avatarCropSrc]);

  const canChangePassword = security.next && security.next === security.confirm && security.current;

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

  const uploadAvatar = async event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    const allowedExtensions = ["png", "jpg", "jpeg", "webp", "gif"];
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(extension)) {
      notify.error("Profile image must be PNG, JPG, WEBP, or GIF.");
      return;
    }
    if (file.size > 6 * 1024 * 1024) {
      notify.error("Profile image must be 6 MB or smaller.");
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

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase text-text-muted">Account</p>
        <h1 className="text-3xl font-bold text-text-primary">Account Settings</h1>
        <p className="mt-1 text-text-secondary">Profile, password, and accessibility preferences for this browser.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
              <UserRound size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Profile</h2>
              <p className="text-sm text-text-secondary">Identity fields stay aligned with your current role session.</p>
            </div>
          </div>

          <div className="mb-5 flex flex-col items-center gap-3 rounded-lg border border-border bg-background-base p-5 sm:flex-row sm:items-center">
            <Avatar name={profile.name} src={profile.avatar_url} size="xl" />
            <div className="flex-1 text-center sm:text-left">
              <strong className="block text-text-primary">{profile.name}</strong>
              <span className="text-sm text-text-muted">{roleLabel(auth?.role)}</span>
            </div>
            <Button as="label" variant="secondary" loading={uploadingAvatar} loadingLabel="Uploading" className="cursor-pointer">
              <Upload size={17} /> Upload
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={uploadAvatar} disabled={uploadingAvatar} />
            </Button>
          </div>

          <div className="grid gap-4">
            <Input label="Full Name" value={profile.name} onChange={event => setProfile(current => ({ ...current, name: event.target.value }))} required />
            <Input
              label="Email"
              type="email"
              value={profile.email}
              onChange={event => setProfile(current => ({ ...current, email: event.target.value }))}
              disabled={auth?.role === "student"}
              helperText={auth?.role === "student" ? "Student email is managed by the school account." : undefined}
            />
            {auth?.role === "student" && (
              <Input label="Roll Number" value={profile.roll} disabled />
            )}
            <Button variant="primary" onClick={saveProfile} loading={savingProfile} loadingLabel="Saving">
              <Save size={17} /> Save Profile
            </Button>
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-danger/10 text-danger">
              <Lock size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Security</h2>
              <p className="text-sm text-text-secondary">Use a strong password to keep your account secure.</p>
            </div>
          </div>

          <div className="grid gap-4">
            <Input label="Current Password" type="password" value={security.current} onChange={event => setSecurity(current => ({ ...current, current: event.target.value }))} required />
            <Input label="New Password" type="password" value={security.next} onChange={event => setSecurity(current => ({ ...current, next: event.target.value }))} required />
            <div className="rounded-pill bg-background-elevated p-1">
              <div className={`h-2 rounded-pill ${strength.color} transition-all duration-300`} style={{ width: strength.width }} />
            </div>
            <p className="text-sm font-semibold text-text-secondary">Strength: {strength.label}</p>
            <Input
              label="Confirm New Password"
              type="password"
              value={security.confirm}
              onChange={event => setSecurity(current => ({ ...current, confirm: event.target.value }))}
              error={security.confirm && security.confirm !== security.next ? "Passwords do not match" : undefined}
              required
            />
            <Button
              type="button"
              variant="primary"
              disabled={!canChangePassword}
              loading={changingPassword}
              loadingLabel="Changing"
              onClick={changePassword}
            >
              <ShieldCheck size={17} /> Change Password
            </Button>
          </div>
        </Card>
      </div>

      {auth?.role === "student" && (
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-info/10 text-info">
              <Type size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Accessibility</h2>
              <p className="text-sm text-text-secondary">These preferences apply immediately in this browser and persist across refreshes.</p>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <span className="mb-3 block text-sm font-semibold text-text-secondary">Font Size</span>
              <div className="grid grid-cols-3 gap-2">
                {["small", "medium", "large"].map(option => (
                  <Button
                    key={option}
                    variant={fontSize === option ? "primary" : "secondary"}
                    onClick={() => setFontSize(option)}
                    className="capitalize"
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center rounded-lg border border-border bg-background-base p-4">
              <Toggle checked={highContrast} onChange={setHighContrast} label="High Contrast Mode" />
            </div>
          </div>
        </Card>
      )}
      <CropModal
        imageSrc={avatarCropSrc}
        aspectRatio={1}
        onConfirm={uploadCroppedAvatar}
        onCancel={clearAvatarCrop}
      />
    </div>
  );
}
