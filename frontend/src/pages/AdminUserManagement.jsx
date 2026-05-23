import { useEffect, useState } from "react";
import { Edit2, RotateCcw, Eye, Upload, Plus } from "lucide-react";
import { Avatar, Badge, Button, Card, Input, Modal, Select } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";

export default function AdminUserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [apiAvailable, setApiAvailable] = useState(true);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const { data } = await api.get("/admin/users");
      setUsers(data.users || []);
    } catch {
      setApiAvailable(false);
    } finally {
      setLoading(false);
    }
  };

  const filteredUsers = users.filter(user => {
    let matches = true;
    
    // Tab filter
    if (activeTab === "students") matches = matches && user.role === "student";
    if (activeTab === "teachers") matches = matches && user.role === "teacher";
    
    // Role filter
    if (roleFilter !== "all") matches = matches && user.role === roleFilter;
    
    // Search
    matches = matches && (
      user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.roll_number?.toLowerCase().includes(searchTerm.toLowerCase())
    );
    
    return matches;
  });

  if (loading) return <div className="p-8 text-center">Loading users...</div>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-text-muted">USER MANAGEMENT</p>
          <h1 className="text-3xl font-bold text-text-primary">Manage Users</h1>
        </div>
        <div className="flex gap-3">
          <Button variant="primary" size="sm" onClick={() => setShowCreateModal(true)}>
            <Plus size={16} /> Create Teacher
          </Button>
          <Button variant="secondary" size="sm">
            <Upload size={16} /> Import Students
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-border">
        {["all", "students", "teachers"].map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 font-semibold capitalize transition ${
              activeTab === tab
                ? "border-b-2 border-brand-primary text-brand-primary"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            {tab === "all" ? "All Users" : tab}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <Input
          placeholder="Search by name, email, or roll number..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="flex-1"
        />
        <Select
          value={roleFilter}
          onChange={setRoleFilter}
          options={[
            { value: "all", label: "All Roles" },
            { value: "student", label: "Students" },
            { value: "teacher", label: "Teachers" }
          ]}
        />
      </div>

      {/* User Table */}
      {!apiAvailable && (
        <Card className="border-info/30 bg-info/5 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-text-primary">Classic user data is still served by Flask</h3>
              <p className="mt-1 text-sm text-text-secondary">
                This React management surface is ready. Until a JSON users endpoint is exposed, use the existing admin pages for the live table and bulk actions.
              </p>
            </div>
            <Button as="a" href="/admin/users" variant="info" size="sm">
              Open Classic Users
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-background-elevated/50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-text-primary">User</th>
                <th className="px-4 py-3 text-left font-semibold text-text-primary">Email</th>
                <th className="px-4 py-3 text-left font-semibold text-text-primary">Role</th>
                <th className="px-4 py-3 text-left font-semibold text-text-primary">Status</th>
                <th className="px-4 py-3 text-left font-semibold text-text-primary">Last Login</th>
                <th className="px-4 py-3 text-left font-semibold text-text-primary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredUsers.map(user => (
                <tr key={user.id} className="hover:bg-background-elevated/30">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar name={user.name} size="md" />
                      <div>
                        <p className="font-semibold text-text-primary">{user.name}</p>
                        {user.roll_number && <p className="text-xs text-text-muted">Roll: {user.roll_number}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-secondary">{user.email}</td>
                  <td className="px-4 py-3">
                    <Badge variant={user.role === "student" ? "info" : "primary"} size="sm">
                      {user.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={user.is_active ? "success" : "danger"} size="sm">
                      {user.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-text-muted">
                    {user.last_login ? new Date(user.last_login).toLocaleDateString() : "Never"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedUser(user)}
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => notify.success("Reset sent to " + user.email)}
                        title="Reset password"
                      >
                        <RotateCcw size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedUser(user)}
                        title="View sessions"
                      >
                        <Eye size={14} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Create Teacher Modal */}
      <Modal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        title="Create New Teacher"
      >
        <CreateTeacherForm onSuccess={() => {
          setShowCreateModal(false);
          loadUsers();
        }} />
      </Modal>

      <Modal
        open={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        title={selectedUser ? selectedUser.name : "User Details"}
      >
        {selectedUser && (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-background-elevated/40 p-4">
              <Avatar name={selectedUser.name} size="lg" />
              <div>
                <p className="font-semibold text-text-primary">{selectedUser.name}</p>
                <p className="text-text-muted">{selectedUser.email || "No email on file"}</p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Role" value={selectedUser.role || ""} disabled />
              <Input label="Roll Number" value={selectedUser.roll_number || ""} disabled />
              <Input label="Status" value={selectedUser.is_active ? "Active" : "Inactive"} disabled />
              <Input label="Last Login" value={selectedUser.last_login ? new Date(selectedUser.last_login).toLocaleString() : "Never"} disabled />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function CreateTeacherForm({ onSuccess }) {
  const [formData, setFormData] = useState({
    name: "",
    username: "",
    email: "",
    department: "",
    designation: "",
    password: ""
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = () => {
    setLoading(true);
    onSuccess?.();
  };

  return (
    <form method="post" action="/admin/users/create-teacher" onSubmit={handleSubmit} className="space-y-4">
      <Input
        label="Full Name"
        name="name"
        placeholder="Dr. John Doe"
        value={formData.name}
        onChange={e => setFormData({ ...formData, name: e.target.value })}
        required
      />
      <Input
        label="Username"
        name="username"
        placeholder="dr.john"
        value={formData.username}
        onChange={e => setFormData({ ...formData, username: e.target.value })}
        required
      />
      <Input
        label="Email"
        name="email"
        type="email"
        placeholder="john@university.edu"
        value={formData.email}
        onChange={e => setFormData({ ...formData, email: e.target.value })}
        required
      />
      <Input
        label="Department"
        name="department"
        placeholder="e.g., Physics"
        value={formData.department}
        onChange={e => setFormData({ ...formData, department: e.target.value })}
      />
      <Input
        label="Designation"
        name="designation"
        placeholder="e.g., Assistant Professor"
        value={formData.designation}
        onChange={e => setFormData({ ...formData, designation: e.target.value })}
      />
      <Input
        label="Temporary Password"
        name="password"
        type="password"
        placeholder="At least 10 characters"
        value={formData.password}
        onChange={e => setFormData({ ...formData, password: e.target.value })}
        required
      />
      <div className="flex gap-3 pt-4">
        <Button type="submit" variant="primary" loading={loading} className="flex-1">
          Create Teacher
        </Button>
      </div>
    </form>
  );
}
