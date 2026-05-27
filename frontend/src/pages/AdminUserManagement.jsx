import { useCallback, useEffect, useMemo, useState } from "react";
import { Download, Edit2, Eye, RotateCcw, Upload, Plus, ShieldCheck, Trash2, UserX } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Avatar, Badge, Button, Card, ConfirmationDialog, Input, Modal, Select, Table, Textarea, Tooltip } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import { formatDate, formatDateShort } from "../utils/dateFormat";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { useDraftAutoSave } from "../hooks/useDraftAutoSave";

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return [];
  const headerIndex = lines.findIndex(line => !line.trim().startsWith("#"));
  if (headerIndex === -1) return [];
  const headers = lines[headerIndex].split(",").map(header => header.trim().toLowerCase());
  return lines.slice(headerIndex + 1).filter(line => !line.trim().startsWith("#")).map((line, index) => {
    const values = line.split(",").map(value => value.trim());
    return headers.reduce((row, header, headerIndex) => {
      row[header || `column_${headerIndex + 1}`] = values[headerIndex] || "";
      return row;
    }, { id: index + 1 });
  });
}

function exportRows(rows) {
  const header = ["name", "username", "email", "role", "roll_number", "status", "created_at"];
  const body = rows.map(row => header.map(key => `"${String(row[key] ?? "").replaceAll('"', '""')}"`).join(","));
  const blob = new window.Blob([[header.join(","), ...body].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "selected-users.csv";
  link.click();
  window.URL.revokeObjectURL(url);
}

function statusLabel(user) {
  return user.is_active ? "Active" : "Inactive";
}

export default function AdminUserManagement() {
  const [searchParams] = useSearchParams();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", email: "", roll_number: "" });
  const [editAdminPassword, setEditAdminPassword] = useState("");
  const [sessionUser, setSessionUser] = useState(null);
  const [sessionRows, setSessionRows] = useState([]);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetAdminPassword, setResetAdminPassword] = useState("");
  const [actionTarget, setActionTarget] = useState(null);
  const [bulkAction, setBulkAction] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [selectedIds, setSelectedIds] = useState([]);
  const [actionBusy, setActionBusy] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => window.clearTimeout(timeoutId);
  }, [searchTerm]);

  const loadUsers = useCallback(async (soft = false) => {
    if (!soft) setLoading(true);
    try {
      const { data } = await api.get("/admin/users");
      setUsers(data.users || []);
    } catch (error) {
      notify.error(error.message || "Could not load users.");
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);
  useLiveRefresh(loadUsers, { intervalMs: 25000 });

  useEffect(() => {
    const draftId = searchParams.get("draft");
    if (draftId) setShowCreateModal(true);
  }, [searchParams]);

  const filteredUsers = useMemo(() => {
    const query = debouncedSearch.trim().toLowerCase();
    return users.filter(user => {
      if (activeTab === "students" && user.role !== "student") return false;
      if (activeTab === "teachers" && user.role !== "teacher") return false;
      if (statusFilter === "active" && !user.is_active) return false;
      if (statusFilter === "inactive" && user.is_active) return false;
      if (!query) return true;
      return [user.name, user.username, user.email, user.roll_number, user.role]
        .some(value => String(value || "").toLowerCase().includes(query));
    });
  }, [activeTab, debouncedSearch, statusFilter, users]);

  const selectedUsers = users.filter(user => selectedIds.includes(String(user.id)));
  const allVisibleSelected = filteredUsers.length > 0 && filteredUsers.every(user => selectedIds.includes(String(user.id)));

  const toggleSelected = id => {
    const normalized = String(id);
    setSelectedIds(current => current.includes(normalized)
      ? current.filter(item => item !== normalized)
      : [...current, normalized]);
  };

  const toggleAllVisible = () => {
    if (allVisibleSelected) {
      const visibleIds = new Set(filteredUsers.map(user => String(user.id)));
      setSelectedIds(current => current.filter(id => !visibleIds.has(id)));
      return;
    }
    setSelectedIds(current => Array.from(new Set([...current, ...filteredUsers.map(user => String(user.id))])));
  };

  const runStatusAction = async (target, desiredActive) => {
    if (!target?.id || !adminPassword.trim()) return;
    setActionBusy(true);
    try {
      const { data } = await api.patch(`/admin/users/${target.id}`, {
        name: target.name,
        username: target.username,
        email: target.email,
        roll_number: target.roll_number,
        is_active: desiredActive,
        admin_password: adminPassword
      });
      setUsers(current => current.map(user => user.id === target.id ? data.user : user));
      notify.success(desiredActive ? "User activated" : "User deactivated");
      setActionTarget(null);
      setAdminPassword("");
    } catch (error) {
      notify.error(error.message || "Could not update user status");
    } finally {
      setActionBusy(false);
    }
  };

  const runDeleteUser = async target => {
    if (!target?.id || !adminPassword.trim()) return;
    setActionBusy(true);
    try {
      const { data } = await api.delete(`/admin/users/${target.id}`, {
        data: { admin_password: adminPassword }
      });
      setUsers(current => current.filter(user => user.id !== target.id));
      setSelectedIds(current => current.filter(id => id !== String(target.id)));
      notify.success(data.message || "User deleted");
      setActionTarget(null);
      setAdminPassword("");
    } catch (error) {
      notify.error(error.message || "Could not delete user");
    } finally {
      setActionBusy(false);
    }
  };

  const runBulkStatus = async desiredActive => {
    if (!adminPassword.trim()) return;
    const targets = selectedUsers.filter(user => user.is_active !== desiredActive);
    if (targets.length === 0) {
      notify.info("Selected users already have that status.");
      setBulkAction("");
      setAdminPassword("");
      return;
    }
    setActionBusy(true);
    try {
      const results = await Promise.all(targets.map(user => api.patch(`/admin/users/${user.id}`, {
        name: user.name,
        username: user.username,
        email: user.email,
        roll_number: user.roll_number,
        is_active: desiredActive,
        admin_password: adminPassword
      })));
      const updatedById = new Map(results.map(result => [String(result.data.user.id), result.data.user]));
      setUsers(current => current.map(user => updatedById.get(String(user.id)) || user));
      notify.success(`${targets.length} user(s) updated`);
      setSelectedIds([]);
      setBulkAction("");
      setAdminPassword("");
    } catch (error) {
      notify.error(error.message || "Bulk status update failed");
    } finally {
      setActionBusy(false);
    }
  };

  const openEdit = user => {
    setSelectedUser(user);
    setEditForm({
      name: user.name || "",
      email: user.email || "",
      roll_number: user.roll_number || ""
    });
    setEditAdminPassword("");
  };

  const saveUserEdit = async event => {
    event.preventDefault();
    if (!selectedUser?.id) return;
    setEditSaving(true);
    try {
      const { data } = await api.patch(`/admin/users/${selectedUser.id}`, {
        ...editForm,
        admin_password: editAdminPassword
      });
      const updated = data.user;
      setUsers(current => current.map(user => String(user.id) === String(updated.id) ? updated : user));
      notify.success("User updated");
      setSelectedUser(null);
      setEditAdminPassword("");
    } catch (error) {
      notify.error(error.message || "Could not update user");
    } finally {
      setEditSaving(false);
    }
  };

  const openSessions = async user => {
    setSessionUser(user);
    setSessionRows([]);
    setSessionLoading(true);
    try {
      const { data } = await api.get(`/admin/users/${user.id}/sessions`);
      setSessionRows(data.sessions || []);
    } catch (error) {
      notify.error(error.message || "Could not load sessions");
    } finally {
      setSessionLoading(false);
    }
  };

  const resetUserPassword = async event => {
    event.preventDefault();
    if (!resetTarget?.id) return;
    setResetBusy(true);
    try {
      await api.post(`/admin/users/${resetTarget.id}/reset-password`, {
        new_password: resetPassword,
        admin_password: resetAdminPassword
      });
      notify.success("Password reset");
      setResetTarget(null);
      setResetPassword("");
      setResetAdminPassword("");
    } catch (error) {
      notify.error(error.message || "Could not reset password");
    } finally {
      setResetBusy(false);
    }
  };

  const columns = [
    {
      key: "select",
      header: (
        <input
          type="checkbox"
          checked={allVisibleSelected}
          onChange={toggleAllVisible}
          aria-label="Select all visible users"
        />
      ),
      headerClassName: "w-12 min-w-12",
      cellClassName: "w-12 min-w-12",
      render: row => (
        <input
          type="checkbox"
          checked={selectedIds.includes(String(row.id))}
          onChange={() => toggleSelected(row.id)}
          aria-label={`Select ${row.name}`}
        />
      )
    },
    {
      key: "name",
      header: "User",
      sortable: true,
      headerClassName: "min-w-[200px]",
      cellClassName: "min-w-[200px]",
      render: row => (
        <div className="flex items-center gap-3">
          <Avatar name={row.name} size="md" />
          <div className="min-w-0">
            <p className="mb-0 font-semibold text-text-primary">{row.name}</p>
            <p className="mb-0 text-xs text-text-muted">@{row.username || "unknown"}</p>
          </div>
        </div>
      )
    },
    {
      key: "email",
      header: "Email",
      sortable: true,
      headerClassName: "min-w-[200px]",
      cellClassName: "min-w-[200px]",
      render: row => <span className="block max-w-[200px] truncate">{row.email || "-"}</span>
    },
    { key: "role", header: "Role", sortable: true, headerClassName: "w-[100px] min-w-[100px]", cellClassName: "w-[100px] min-w-[100px]", render: row => <Badge variant={row.role === "student" ? "info" : row.role === "teacher" ? "purple" : "warning"}>{row.role}</Badge> },
    { key: "roll_number", header: "Roll", sortable: true, headerClassName: "w-20 min-w-20", cellClassName: "w-20 min-w-20", render: row => row.roll_number || "-" },
    { key: "is_active", header: "Status", sortable: true, headerClassName: "w-[100px] min-w-[100px]", cellClassName: "w-[100px] min-w-[100px]", render: row => <Badge variant={row.is_active ? "success" : "danger"}>{statusLabel(row)}</Badge> },
    { key: "created_at", header: "Joined", sortable: true, headerClassName: "w-[140px] min-w-[140px]", cellClassName: "w-[140px] min-w-[140px]", render: row => formatDateShort(row.created_at) }
  ];

  if (loading) return <Card className="p-8 text-center text-text-muted">Loading users...</Card>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">User management</p>
          <h1 className="text-3xl font-bold text-text-primary">Manage Users</h1>
          <p className="mt-1 text-text-secondary">Manage student and teacher accounts across the platform.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} /> Create Teacher
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setShowImportModal(true)}>
            <Upload size={16} /> Import Students
          </Button>
        </div>
      </div>

      <Card className="p-3">
        <div className="flex flex-wrap gap-2">
          {[
            { id: "all", label: "All Users" },
            { id: "students", label: "Students" },
            { id: "teachers", label: "Teachers" }
          ].map(tab => (
            <Button key={tab.id} variant={activeTab === tab.id ? "primary" : "ghost"} size="sm" onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </Button>
          ))}
        </div>
      </Card>

      <Card className="p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
          <Input
            label="Search"
            placeholder="Search by name, username, email, role, or roll number"
            value={searchTerm}
            onChange={event => setSearchTerm(event.target.value)}
          />
          <Select
            label="Status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "all", label: "All Status" },
              { value: "active", label: "Active" },
              { value: "inactive", label: "Inactive" }
            ]}
          />
        </div>
      </Card>

      {selectedIds.length > 0 && (
        <Card className="sticky top-20 z-20 border-brand-primary/30 bg-brand-primary/5 p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <strong className="text-text-primary">{selectedIds.length} selected</strong>
            <div className="flex flex-wrap gap-2">
              <Button variant="success" size="sm" onClick={() => setBulkAction("activate")}>
                <ShieldCheck size={16} /> Activate Selected
              </Button>
              <Button variant="danger" size="sm" onClick={() => setBulkAction("deactivate")}>
                <UserX size={16} /> Deactivate Selected
              </Button>
              <Button variant="secondary" size="sm" onClick={() => exportRows(selectedUsers)}>
                <Download size={16} /> Export CSV
              </Button>
            </div>
          </div>
        </Card>
      )}

      <Table
        columns={columns}
        data={filteredUsers}
        rowsPerPageOptions={[10, 20, 50]}
        emptyMessage="No users found"
        tableClassName="min-w-[1080px]"
        renderRowActions={row => (
          <>
            <Tooltip label="Edit">
              <Button variant="ghost" size="sm" className="h-10 w-10 px-0" onClick={() => openEdit(row)} aria-label="Edit user">
                <Edit2 size={17} />
              </Button>
            </Tooltip>
            <Tooltip label="Sessions">
              <Button variant="ghost" size="sm" className="h-10 w-10 px-0" onClick={() => openSessions(row)} aria-label="View sessions">
                <Eye size={17} />
              </Button>
            </Tooltip>
            <Tooltip label="Reset password">
              <Button variant="ghost" size="sm" className="h-10 w-10 px-0 text-info hover:bg-info/10" onClick={() => setResetTarget(row)} aria-label="Reset password">
                <RotateCcw size={17} />
              </Button>
            </Tooltip>
            <Tooltip label={row.is_active ? "Deactivate" : "Activate"}>
              <Button
                variant="ghost"
                size="sm"
                className={row.is_active ? "h-10 w-10 border border-danger/40 px-0 text-danger hover:bg-danger/10" : "h-10 w-10 border border-success/40 px-0 text-success hover:bg-success/10"}
                onClick={() => setActionTarget({ type: row.is_active ? "deactivate" : "activate", user: row })}
                aria-label={row.is_active ? "Deactivate user" : "Activate user"}
              >
                {row.is_active ? <UserX size={17} /> : <ShieldCheck size={17} />}
              </Button>
            </Tooltip>
            <Tooltip label="Delete">
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 border border-danger/40 px-0 text-danger hover:bg-danger/10"
                onClick={() => setActionTarget({ type: "delete", user: row })}
                aria-label="Delete user"
              >
                <Trash2 size={17} />
              </Button>
            </Tooltip>
          </>
        )}
      />

      <Modal open={showCreateModal} onClose={() => setShowCreateModal(false)} title="Create New Teacher">
        <CreateTeacherForm
          restoreDraftId={searchParams.get("draft")}
          onCreated={user => {
            if (user) setUsers(current => [user, ...current]);
            setShowCreateModal(false);
          }}
        />
      </Modal>

      <Modal open={showImportModal} onClose={() => setShowImportModal(false)} title="Import Students" className="max-w-3xl">
        <ImportStudentsForm
          onImported={data => {
            if (data?.users?.length) {
              setUsers(current => [...data.users, ...current]);
            }
          }}
        />
      </Modal>

      <Modal
        open={!!selectedUser}
        onClose={() => {
          setSelectedUser(null);
          setEditAdminPassword("");
        }}
        title={selectedUser ? `Edit ${selectedUser.name}` : "User Details"}
        className="max-w-2xl"
      >
        {selectedUser && (
          <form className="space-y-4" onSubmit={saveUserEdit}>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background-elevated/40 p-4">
              <Avatar name={selectedUser.name} size="lg" />
              <div>
                <p className="mb-0 font-semibold text-text-primary">{selectedUser.name}</p>
                <p className="mb-0 text-sm text-text-muted">{selectedUser.email || "No email on file"}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Full Name" value={editForm.name} onChange={event => setEditForm({ ...editForm, name: event.target.value })} required />
              <Input label="Username" value={selectedUser.username || ""} disabled />
              <Input label="Email" value={editForm.email} onChange={event => setEditForm({ ...editForm, email: event.target.value })} />
              <Input label="Roll Number" value={editForm.roll_number} onChange={event => setEditForm({ ...editForm, roll_number: event.target.value })} disabled={selectedUser.role !== "student"} />
              <Input label="Role" value={selectedUser.role || ""} disabled />
              <Input label="Status" value={statusLabel(selectedUser)} disabled />
            </div>
            <Input
              label="Admin Password"
              type="password"
              value={editAdminPassword}
              onChange={event => setEditAdminPassword(event.target.value)}
              required
              autoComplete="current-password"
              helperText="Required before changing account details."
            />
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button type="submit" variant="primary" loading={editSaving} loadingLabel="Saving">Save User</Button>
              <Button type="button" variant="secondary" onClick={() => setSelectedUser(null)}>Cancel</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!sessionUser} onClose={() => setSessionUser(null)} title={sessionUser ? `${sessionUser.name} Sessions` : "Sessions"}>
        <div className="space-y-4">
          {sessionLoading ? (
            <Card className="p-5 text-center text-text-muted">Loading sessions...</Card>
          ) : sessionRows.length > 0 ? (
            <div className="max-h-96 overflow-auto rounded-lg border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-background-elevated text-text-secondary">
                  <tr>
                    <th className="px-3 py-2">Exam</th>
                    <th className="px-3 py-2">Started</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {sessionRows.map(row => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 text-text-primary">{row.exam_name || "-"}</td>
                      <td className="px-3 py-2 text-text-secondary">{formatDate(row.start_time)}</td>
                      <td className="px-3 py-2"><Badge variant={row.status === "active" ? "success" : "secondary"}>{row.status}</Badge></td>
                      <td className="px-3 py-2 text-text-primary">{row.score == null ? "-" : `${row.score}/${row.total_marks}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Card className="p-5 text-center text-text-muted">No session history found.</Card>
          )}
        </div>
      </Modal>

      <Modal
        open={!!resetTarget}
        onClose={() => {
          setResetTarget(null);
          setResetPassword("");
          setResetAdminPassword("");
        }}
        title={resetTarget ? `Reset ${resetTarget.name}'s Password` : "Reset Password"}
      >
        <form className="space-y-4" onSubmit={resetUserPassword}>
          <Input
            label="New Password"
            type="password"
            value={resetPassword}
            onChange={event => setResetPassword(event.target.value)}
            minLength={10}
            required
            helperText="Use at least 10 characters with uppercase, lowercase, and a number."
          />
          <Input
            label="Admin Password"
            type="password"
            value={resetAdminPassword}
            onChange={event => setResetAdminPassword(event.target.value)}
            required
            autoComplete="current-password"
          />
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="submit" variant="danger" loading={resetBusy} loadingLabel="Resetting">Reset Password</Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setResetTarget(null);
                setResetPassword("");
                setResetAdminPassword("");
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmationDialog
        open={!!actionTarget}
        title={actionTarget?.type === "delete" ? "Delete User?" : actionTarget?.type === "deactivate" ? "Deactivate User?" : "Activate User?"}
        description={(
          <div className="space-y-3">
            <p>
              {actionTarget?.type === "delete"
                ? "This removes the user from this list, disables account access, and keeps records for audit/results."
                : actionTarget?.type === "deactivate"
                  ? "This disables account access while keeping the user in this list."
                  : "This restores account access."}
            </p>
            <Input
              label="Admin Password"
              type="password"
              value={adminPassword}
              onChange={event => setAdminPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
        )}
        confirmLabel={actionTarget?.type === "delete" ? "Delete" : actionTarget?.type === "deactivate" ? "Deactivate" : "Activate"}
        confirmWord={actionTarget?.type === "delete" ? "DELETE" : undefined}
        variant={actionTarget?.type === "activate" ? "success" : "danger"}
        onConfirm={() => {
          if (actionTarget?.type === "delete") {
            runDeleteUser(actionTarget.user);
            return;
          }
          runStatusAction(actionTarget.user, actionTarget?.type === "activate");
        }}
        loading={actionBusy}
        onClose={() => {
          setActionTarget(null);
          setAdminPassword("");
        }}
      />

      <ConfirmationDialog
        open={Boolean(bulkAction)}
        title={bulkAction === "deactivate" ? "Deactivate Selected Users?" : "Activate Selected Users?"}
        description={(
          <div className="space-y-3">
            <p>{selectedUsers.map(user => user.name).join(", ")}</p>
            <Input
              label="Admin Password"
              type="password"
              value={adminPassword}
              onChange={event => setAdminPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
        )}
        confirmLabel={bulkAction === "deactivate" ? "Deactivate Selected" : "Activate Selected"}
        confirmWord={bulkAction === "deactivate" ? "DELETE" : undefined}
        variant={bulkAction === "deactivate" ? "danger" : "success"}
        onConfirm={() => runBulkStatus(bulkAction === "activate")}
        loading={actionBusy}
        onClose={() => {
          setBulkAction("");
          setAdminPassword("");
        }}
      />
    </div>
  );
}

function CreateTeacherForm({ onCreated, restoreDraftId }) {
  const [formData, setFormData] = useState({
    name: "",
    username: "",
    email: "",
    department: "",
    designation: "",
    password: ""
  });
  const [creating, setCreating] = useState(false);

  const restoreTeacherDraft = useCallback(draftData => {
    setFormData({
      name: draftData.name || "",
      username: draftData.username || "",
      email: draftData.email || "",
      department: draftData.department || "",
      designation: draftData.designation || "",
      password: ""
    });
  }, []);

  const teacherDraft = useDraftAutoSave({
    draftType: "admin_teacher",
    formState: { ...formData, password: "" },
    titlePreview: formData.name || formData.username,
    onRestore: restoreTeacherDraft
  });

  useEffect(() => {
    if (!restoreDraftId) return;
    let active = true;
    async function restoreFromQuery() {
      try {
        const { data } = await api.get(`/drafts/${restoreDraftId}`);
        if (active && data.draft?.draft_type === "admin_teacher") restoreTeacherDraft(data.draft.draft_data || {});
      } catch {
        // The reusable hook still checks any cached draft for this form.
      }
    }
    restoreFromQuery();
    return () => {
      active = false;
    };
  }, [restoreDraftId, restoreTeacherDraft]);

  const handleSubmit = async event => {
    event.preventDefault();
    setCreating(true);
    try {
      const { data } = await api.post("/admin/users/teachers", formData);
      notify.success(data.message || "Teacher account created");
      setFormData({
        name: "",
        username: "",
        email: "",
        department: "",
        designation: "",
        password: ""
      });
      await teacherDraft.clearDraft();
      onCreated?.(data.user);
    } catch (error) {
      notify.error(error.message || "Could not create teacher");
    } finally {
      setCreating(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {teacherDraft.banner}
      <Input label="Full Name" name="name" value={formData.name} onChange={event => setFormData({ ...formData, name: event.target.value })} required />
      <Input label="Username" name="username" value={formData.username} onChange={event => setFormData({ ...formData, username: event.target.value })} required />
      <Input label="Email" name="email" type="email" value={formData.email} onChange={event => setFormData({ ...formData, email: event.target.value })} required />
      <Input label="Department" name="department" value={formData.department} onChange={event => setFormData({ ...formData, department: event.target.value })} />
      <Input label="Designation" name="designation" value={formData.designation} onChange={event => setFormData({ ...formData, designation: event.target.value })} />
      <Input label="Temporary Password" name="password" type="password" value={formData.password} onChange={event => setFormData({ ...formData, password: event.target.value })} required />
      <Button type="submit" variant="primary" className="w-full" loading={creating} loadingLabel="Creating">Create Teacher</Button>
      <div className="text-right">{teacherDraft.indicator}</div>
    </form>
  );
}

function ImportStudentsForm({ onImported }) {
  const [rows, setRows] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const onFileChange = event => {
    const file = event.target.files?.[0];
    if (!file) {
      setRows([]);
      return;
    }
    const reader = new window.FileReader();
    reader.onload = () => setRows(parseCsv(String(reader.result || "")));
    reader.readAsText(file);
  };

  const handleSubmit = async event => {
    event.preventDefault();
    if (!rows.length) return;
    setImporting(true);
    try {
      const cleanedRows = rows.map(row => {
        const cleaned = { ...row };
        delete cleaned.id;
        return cleaned;
      });
      const { data } = await api.post("/admin/users/import-students", { rows: cleanedRows });
      setResult(data);
      notify.success(data.message || "Student import finished");
      onImported?.(data);
    } catch (error) {
      notify.error(error.message || "Could not import students");
    } finally {
      setImporting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-text-secondary">
          CSV File <span className="text-danger" aria-hidden="true">*</span>
        </span>
        <div className="rounded-lg border-2 border-dashed border-border bg-background-base p-6 text-center">
          <Upload size={32} className="mx-auto mb-3 text-text-muted" />
          <p className="text-sm text-text-secondary">Accepted columns: name, email, roll_number, username, password</p>
          <Button as="a" href="/api/admin/students/import-template" variant="secondary" size="sm" className="mt-3">
            Download Template
          </Button>
          <input name="students_file" type="file" accept=".csv" required onChange={onFileChange} className="mt-4 w-full text-sm text-text-secondary" />
        </div>
      </label>
      {rows.length > 0 && (
        <div className="max-h-64 overflow-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-background-elevated text-text-secondary">
              <tr>
                {Object.keys(rows[0]).filter(key => key !== "id").map(key => <th className="px-3 py-2" key={key}>{key}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.slice(0, 20).map(row => (
                <tr key={row.id}>
                  {Object.entries(row).filter(([key]) => key !== "id").map(([key, value]) => <td className="px-3 py-2 text-text-primary" key={key}>{value}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Textarea
        label="Column Mapping"
        value={"CSV name -> Full name\nCSV email -> Email\nCSV roll_number -> Roll number\nCSV username -> Username\nCSV password -> Temporary password"}
        readOnly
        rows={5}
      />
      {result && (
        <Card className="border-success/30 bg-success/5 p-4 text-sm text-text-secondary">
          Created {result.created || 0}, skipped {result.skipped || 0}, failed {result.failed?.length || 0}.
        </Card>
      )}
      <Button type="submit" variant="primary" className="w-full" disabled={rows.length === 0} loading={importing} loadingLabel="Importing">
        Import {rows.length || ""} Students
      </Button>
    </form>
  );
}
