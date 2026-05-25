import { useCallback, useEffect, useState } from "react";
import { Copy, Plus, RefreshCw, Search, Trash2, UserPlus, X } from "lucide-react";
import { Avatar, Badge, Button, Card, ConfirmationDialog, EmptyState, Input, Textarea } from "../components/ui";
import { api } from "../services/api";
import { notify } from "../components/ui/Toast";
import { useLiveRefresh } from "../hooks/useLiveRefresh";

export default function AdminGroups() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [newGroup, setNewGroup] = useState({ name: "", description: "" });
  const [memberDrafts, setMemberDrafts] = useState({});
  const [studentSearches, setStudentSearches] = useState({});
  const [studentResults, setStudentResults] = useState({});
  const [searchingGroupId, setSearchingGroupId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [adminPassword, setAdminPassword] = useState("");

  const loadGroups = useCallback(async (soft = false) => {
    if (!soft) setLoading(true);
    try {
      const { data } = await api.get("/admin/groups");
      setGroups(data.groups || []);
    } catch {
      notify.error("Could not load groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);
  useLiveRefresh(loadGroups, { intervalMs: 25000 });

  const filteredGroups = groups.filter(group => group.name.toLowerCase().includes(search.toLowerCase()));

  const createGroup = async event => {
    event.preventDefault();
    try {
      const { data } = await api.post("/admin/groups", newGroup);
      setGroups(current => [...current, data.group].sort((left, right) => left.name.localeCompare(right.name)));
      setNewGroup({ name: "", description: "" });
      notify.success("Group created");
    } catch (error) {
      notify.error(error.response?.data?.message || "Could not create group");
    }
  };

  const addMembers = async group => {
    const members = memberDrafts[group.id] || "";
    if (!members.trim()) return;
    try {
      const { data } = await api.post(`/admin/groups/${group.id}/members`, { members });
      setGroups(current => current.map(item => item.id === group.id ? data.group : item));
      setMemberDrafts(current => ({ ...current, [group.id]: "" }));
      notify.success(`Added ${data.added} student(s), skipped ${data.skipped}`);
    } catch (error) {
      notify.error(error.response?.data?.message || "Could not add members");
    }
  };

  const searchStudents = async group => {
    const query = (studentSearches[group.id] || "").trim();
    if (query.length < 2) {
      notify.error("Type at least two characters to search students.");
      return;
    }
    setSearchingGroupId(group.id);
    try {
      const { data } = await api.get("/admin/students/search", { params: { q: query } });
      setStudentResults(current => ({ ...current, [group.id]: data.students || [] }));
    } catch (error) {
      notify.error(error.response?.data?.message || "Could not search students");
    } finally {
      setSearchingGroupId(null);
    }
  };

  const addStudentToGroup = async (group, student) => {
    try {
      const { data } = await api.post(`/admin/groups/${group.id}/members`, { student_id: student.id });
      setGroups(current => current.map(item => item.id === group.id ? data.group : item));
      setStudentResults(current => ({ ...current, [group.id]: [] }));
      setStudentSearches(current => ({ ...current, [group.id]: "" }));
      notify.success(`${student.name} added to ${group.name}`);
    } catch (error) {
      notify.error(error.response?.data?.message || "Could not add student");
    }
  };

  const regenerateCode = async group => {
    try {
      const { data } = await api.patch(`/admin/groups/${group.id}/join-code`);
      setGroups(current => current.map(item => item.id === group.id ? data.group : item));
      notify.success("Batch code regenerated");
    } catch (error) {
      notify.error(error.response?.data?.message || "Could not regenerate code");
    }
  };

  const copyCode = async code => {
    if (!code) return;
    try {
      await window.navigator.clipboard.writeText(code);
      notify.success("Batch code copied");
    } catch {
      notify.error("Could not copy code");
    }
  };

  const removeMember = async (group, member) => {
    try {
      const { data } = await api.delete(`/admin/groups/${group.id}/members/${member.id}`);
      setGroups(current => current.map(item => item.id === group.id ? data.group : item));
      notify.success("Member removed");
    } catch {
      notify.error("Could not remove member");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget || !adminPassword.trim()) return;
    try {
      await api.delete(`/admin/groups/${deleteTarget.id}`, { data: { admin_password: adminPassword } });
      setGroups(current => current.filter(group => group.id !== deleteTarget.id));
      notify.success("Group deleted");
      setDeleteTarget(null);
      setAdminPassword("");
    } catch (error) {
      notify.error(error.response?.data?.message || "Could not delete group");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Admin workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Groups</h1>
          <p className="mt-1 text-text-secondary">Organise students into batches for easy exam assignment.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
              <Plus size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Create Group</h2>
            </div>
          </div>
          <form onSubmit={createGroup} className="space-y-4">
            <Input label="Group Name" value={newGroup.name} onChange={event => setNewGroup(current => ({ ...current, name: event.target.value }))} placeholder="Batch A 2026" required />
            <Textarea label="Description" value={newGroup.description} onChange={event => setNewGroup(current => ({ ...current, description: event.target.value }))} rows={3} placeholder="Optional note" />
            <Button type="submit" variant="primary" className="w-full">
              <Plus size={18} /> Create Group
            </Button>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <Input label="Search Groups" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search by group name" />
          </Card>

          {loading ? (
            <Card className="p-8 text-center text-text-muted">Loading groups...</Card>
          ) : filteredGroups.length === 0 ? (
            <EmptyState icon={Search} heading="No groups found" description="Create a group to start assigning students in batches." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {filteredGroups.map(group => (
                <Card key={group.id} className="p-5">
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-text-primary">{group.name}</h2>
                      <p className="text-sm text-text-secondary">{group.description || "No description"}</p>
                    </div>
                    <Badge variant="info">{group.student_count} students</Badge>
                  </div>

                  <div className="mb-4 rounded-lg border border-brand-primary/20 bg-brand-primary/5 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase text-text-muted">Student join code</p>
                        <p className="font-mono text-2xl font-bold tracking-[0.2em] text-brand-primary">{group.join_code || "--------"}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" variant="secondary" size="sm" onClick={() => copyCode(group.join_code)}>
                          <Copy size={16} /> Copy
                        </Button>
                        <Button type="button" variant="ghost" size="sm" onClick={() => regenerateCode(group)}>
                          <RefreshCw size={16} /> Regenerate
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 rounded-lg border border-border bg-background-base p-3">
                    <div className="rounded-lg border border-border bg-background-surface p-3">
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                        <Input
                          label="Search Students"
                          value={studentSearches[group.id] || ""}
                          onChange={event => setStudentSearches(current => ({ ...current, [group.id]: event.target.value }))}
                          placeholder="Search by name, roll, username, or email"
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          loading={searchingGroupId === group.id}
                          loadingLabel="Searching"
                          onClick={() => searchStudents(group)}
                        >
                          <Search size={16} /> Search
                        </Button>
                      </div>
                      {(studentResults[group.id] || []).length > 0 && (
                        <div className="mt-3 max-h-56 overflow-y-auto rounded-lg border border-border">
                          {(studentResults[group.id] || []).map(student => (
                            <button
                              key={student.id}
                              type="button"
                              onClick={() => addStudentToGroup(group, student)}
                              className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-background-elevated"
                            >
                              <span className="flex min-w-0 items-center gap-3">
                                <Avatar name={student.name} src={student.profile_picture} size="sm" />
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-semibold text-text-primary">{student.name}</span>
                                  <span className="block truncate text-xs text-text-muted">{student.roll_number || student.username} | {student.email || "No email"}</span>
                                </span>
                              </span>
                              <Badge variant="info" size="sm">Add</Badge>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <Textarea
                      label="Add Members"
                      value={memberDrafts[group.id] || ""}
                      onChange={event => setMemberDrafts(current => ({ ...current, [group.id]: event.target.value }))}
                      rows={4}
                      placeholder="Paste roll number, username, or email, one per line"
                    />
                    <Button type="button" variant="secondary" size="sm" onClick={() => addMembers(group)}>
                      <UserPlus size={16} /> Add Students
                    </Button>
                  </div>

                  {group.members.length > 0 && (
                    <div className="mt-4 max-h-56 overflow-auto rounded-lg border border-border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-background-elevated text-text-secondary">
                          <tr>
                            <th className="px-3 py-2">Student</th>
                            <th className="px-3 py-2">Roll</th>
                            <th className="px-3 py-2">Email</th>
                            <th className="px-3 py-2 text-right">Remove</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {group.members.map(member => (
                            <tr key={member.id}>
                              <td className="px-3 py-2 text-text-primary">
                                <span className="flex items-center gap-2">
                                  <Avatar name={member.name} src={member.profile_picture} size="sm" />
                                  <span>{member.name}</span>
                                </span>
                              </td>
                              <td className="px-3 py-2 text-text-secondary">{member.roll_number || "-"}</td>
                              <td className="px-3 py-2 text-text-secondary">{member.email || "-"}</td>
                              <td className="px-3 py-2 text-right">
                                <Button variant="ghost" size="sm" className="h-10 w-10 px-0" onClick={() => removeMember(group, member)} aria-label="Remove member">
                                  <X size={16} />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="mt-4 flex justify-end">
                    <Button variant="danger" size="sm" onClick={() => setDeleteTarget(group)}>
                      <Trash2 size={16} /> Delete
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmationDialog
        open={!!deleteTarget}
        title="Delete Group?"
        description={(
          <div className="space-y-3">
            <p>Student accounts remain, but the group and its membership list will be removed.</p>
            <Input label="Admin Password" type="password" value={adminPassword} onChange={event => setAdminPassword(event.target.value)} />
          </div>
        )}
        confirmLabel="Delete"
        confirmWord="DELETE"
        variant="danger"
        onConfirm={confirmDelete}
        onClose={() => {
          setDeleteTarget(null);
          setAdminPassword("");
        }}
      />
    </div>
  );
}
