import { useCallback, useEffect, useState } from "react";
import { Copy, Plus, RefreshCw, Search, Trash2, UserPlus, X } from "lucide-react";
import { Avatar, Badge, Button, Card, ConfirmationDialog, EmptyState } from "../components/ui";
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
  const panelClass = "rounded-2xl border border-white/10 bg-[#1e2130] shadow-xl";
  const fieldClass = "w-full rounded-xl border border-white/10 bg-[#141827] px-4 py-2.5 text-white placeholder-gray-500 outline-none transition-all duration-200 focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500";
  const labelClass = "text-sm font-medium text-gray-300";
  const ghostButtonClass = "inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-gray-200 transition-all duration-200 hover:bg-white/5 hover:text-white";

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
    if (!deleteTarget) return;
    try {
      await api.delete(`/admin/groups/${deleteTarget.id}`);
      setGroups(current => current.filter(group => group.id !== deleteTarget.id));
      notify.success("Group deleted");
      setDeleteTarget(null);
    } catch (error) {
      notify.error(error.response?.data?.message || "Could not delete group");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-indigo-300/80">Admin workspace</p>
          <h1 className="mt-2 text-3xl font-bold text-white">Groups</h1>
          <p className="mt-2 text-sm text-gray-400">Organise students into polished batches, share join codes, and manage membership from one focused workspace.</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[400px_minmax(0,1fr)]">
        <Card className={`${panelClass} p-6`}>
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-indigo-500/10 text-indigo-300">
              <Plus size={22} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-gray-500">Group setup</p>
              <h2 className="text-xl font-semibold text-white">Create Group</h2>
            </div>
          </div>
          <form onSubmit={createGroup} className="space-y-4">
            <label className="grid gap-2">
              <span className={labelClass}>Group Name <span className="text-red-400">*</span></span>
              <input className={fieldClass} value={newGroup.name} onChange={event => setNewGroup(current => ({ ...current, name: event.target.value }))} placeholder="Batch A 2026" required />
            </label>
            <label className="grid gap-2">
              <span className={labelClass}>Description</span>
              <textarea className={`${fieldClass} min-h-28 resize-y`} value={newGroup.description} onChange={event => setNewGroup(current => ({ ...current, description: event.target.value }))} rows={3} placeholder="Optional note" />
            </label>
            <button type="submit" className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-2.5 font-semibold text-white shadow-lg shadow-indigo-950/30 transition-all duration-200 hover:opacity-90">
              <Plus size={18} /> Create Group
            </button>
          </form>
        </Card>

        <div className="space-y-4">
          <Card className={`${panelClass} p-6`}>
            <label className="grid gap-2">
              <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">Search Groups</span>
              <span className="relative block">
                <Search className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                <input
                  className="w-full rounded-full border border-white/10 bg-[#141827] py-2.5 pl-12 pr-5 text-white placeholder-gray-500 outline-none transition-all duration-200 focus:border-indigo-400/50 focus:ring-2 focus:ring-indigo-500"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search by group name"
                />
              </span>
            </label>
          </Card>

          {loading ? (
            <Card className={`${panelClass} p-8 text-center text-gray-400`}>Loading groups...</Card>
          ) : filteredGroups.length === 0 ? (
            <EmptyState icon={Search} heading="No groups found" description="Create a group to start assigning students in batches." />
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {filteredGroups.map(group => (
                <Card key={group.id} className={`${panelClass} border-l-4 border-l-indigo-500 p-6 transition-all duration-200 hover:border-indigo-500/40`}>
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold text-white">{group.name}</h2>
                      <p className="mt-1 text-sm italic text-gray-500">{group.description || "No description"}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-indigo-500/20 px-3 py-1 text-xs font-semibold text-indigo-300">{group.student_count} students</span>
                  </div>

                  <div className="mb-4 rounded-xl border border-indigo-400/30 bg-indigo-500/10 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-200/70">Student join code</p>
                        <p className="mt-1 font-mono text-2xl font-bold tracking-[0.3em] text-indigo-300">{group.join_code || "--------"}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={ghostButtonClass} onClick={() => copyCode(group.join_code)}>
                          <Copy size={16} /> Copy
                        </button>
                        <button type="button" className={ghostButtonClass} onClick={() => regenerateCode(group)}>
                          <RefreshCw size={16} /> Regenerate
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4 rounded-xl border border-white/10 bg-[#141827]/70 p-4">
                    <div className="rounded-xl border border-white/10 bg-[#1e2130] p-4">
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                        <label className="grid gap-2">
                          <span className={labelClass}>Search Students</span>
                          <input
                            className={fieldClass}
                            value={studentSearches[group.id] || ""}
                            onChange={event => setStudentSearches(current => ({ ...current, [group.id]: event.target.value }))}
                            placeholder="Search by name, roll, username, or email"
                          />
                        </label>
                        <Button
                          type="button"
                          variant="secondary"
                          className="rounded-lg border-white/10 bg-transparent transition-all duration-200 hover:bg-white/5"
                          loading={searchingGroupId === group.id}
                          loadingLabel="Searching"
                          onClick={() => searchStudents(group)}
                        >
                          <Search size={16} /> Search
                        </Button>
                      </div>
                      {(studentResults[group.id] || []).length > 0 && (
                        <div className="mt-3 max-h-56 overflow-y-auto rounded-xl border border-white/10">
                          {(studentResults[group.id] || []).map(student => (
                            <button
                              key={student.id}
                              type="button"
                              onClick={() => addStudentToGroup(group, student)}
                              className="flex w-full items-center justify-between gap-3 border-b border-white/10 px-3 py-2 text-left transition-all duration-200 last:border-0 hover:bg-white/5"
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
                    <label className="grid gap-2">
                      <span className={labelClass}>Add Members</span>
                      <textarea
                        className={`${fieldClass} min-h-32 resize-y`}
                        value={memberDrafts[group.id] || ""}
                        onChange={event => setMemberDrafts(current => ({ ...current, [group.id]: event.target.value }))}
                        rows={4}
                        placeholder="Paste roll number, username, or email, one per line"
                      />
                    </label>
                    <Button type="button" variant="secondary" size="sm" className="rounded-lg border-white/10 bg-transparent transition-all duration-200 hover:bg-white/5" onClick={() => addMembers(group)}>
                      <UserPlus size={16} /> Add Students
                    </Button>
                  </div>

                  {group.members.length > 0 && (
                    <div className="mt-4 max-h-56 overflow-auto rounded-xl border border-white/10">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-white/5 text-gray-400">
                          <tr>
                            <th className="px-3 py-2">Student</th>
                            <th className="px-3 py-2">Roll</th>
                            <th className="px-3 py-2">Email</th>
                            <th className="px-3 py-2 text-right">Remove</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/10">
                          {group.members.map(member => (
                            <tr key={member.id}>
                              <td className="px-3 py-2 text-white">
                                <span className="flex items-center gap-2">
                                  <Avatar name={member.name} src={member.profile_picture} size="sm" />
                                  <span>{member.name}</span>
                                </span>
                              </td>
                              <td className="px-3 py-2 text-gray-400">{member.roll_number || "-"}</td>
                              <td className="px-3 py-2 text-gray-400">{member.email || "-"}</td>
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
                    <Button variant="danger" size="sm" className="rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 transition-all duration-200 hover:bg-red-500/20" onClick={() => setDeleteTarget(group)}>
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
          </div>
        )}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onClose={() => {
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
