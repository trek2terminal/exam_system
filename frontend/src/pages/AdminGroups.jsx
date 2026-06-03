import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Copy, FileText, Hash, Plus, RefreshCw, Search, Trash2, UserPlus, Users, X } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Avatar, Badge, Button, Card, ConfirmationDialog, EmptyState, PageLoading, RefreshStatus } from "../components/ui";
import { api, cachedGet } from "../services/api";
import { notify } from "../components/ui/Toast";
import { useLiveRefresh } from "../hooks/useLiveRefresh";
import { useDraftAutoSave } from "../hooks/useDraftAutoSave";

function groupInitial(name = "") {
  return String(name || "G").trim()[0]?.toUpperCase() || "G";
}

function memberCount(group) {
  return Number(group.student_count ?? group.members?.length ?? 0);
}

function studentLabel(count) {
  return `${Number(count || 0).toLocaleString()} student${Number(count || 0) === 1 ? "" : "s"}`;
}

export default function AdminGroups() {
  const [searchParams] = useSearchParams();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [livePaused, setLivePaused] = useState(false);
  const [loadedAt, setLoadedAt] = useState(null);
  const [search, setSearch] = useState("");
  const [newGroup, setNewGroup] = useState({ name: "", description: "" });
  const [memberDrafts, setMemberDrafts] = useState({});
  const [studentSearches, setStudentSearches] = useState({});
  const [studentResults, setStudentResults] = useState({});
  const [searchingGroupId, setSearchingGroupId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const loadGroups = useCallback(async (soft = false, options = {}) => {
    if (!soft) setLoading(true);
    try {
      const { data } = await cachedGet("/admin/groups", { cacheTtl: options.force ? 0 : soft ? 8000 : 1000 });
      setGroups(data.groups || []);
      setLoadedAt(Date.now());
    } catch {
      notify.error("Could not load groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);
  const liveRefresh = useLiveRefresh(loadGroups, { enabled: !livePaused, intervalMs: 25000 });

  const restoreGroupDraft = useCallback(draftData => {
    setNewGroup({
      name: draftData.name || "",
      description: draftData.description || ""
    });
  }, []);

  const groupDraft = useDraftAutoSave({
    draftType: "admin_group",
    formState: newGroup,
    titlePreview: newGroup.name,
    onRestore: restoreGroupDraft,
    enabled: !loading
  });

  useEffect(() => {
    const draftId = searchParams.get("draft");
    if (!draftId) return;
    let active = true;
    async function restoreFromQuery() {
      try {
        const { data } = await api.get(`/drafts/${draftId}`);
        if (active) restoreGroupDraft(data.draft?.draft_data || {});
      } catch (error) {
        notify.error(error.message || "Could not restore draft");
      }
    }
    restoreFromQuery();
    return () => {
      active = false;
    };
  }, [restoreGroupDraft, searchParams]);

  const normalizedSearch = search.trim().toLowerCase();
  const filteredGroups = groups.filter(group => {
    if (!normalizedSearch) return true;
    return [group.name, group.description, group.join_code]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedSearch);
  });
  const totalStudents = groups.reduce((total, group) => total + memberCount(group), 0);
  const groupsWithCodes = groups.filter(group => group.join_code).length;
  const summaryCards = [
    { label: "Active groups", value: groups.length, helper: "Managed batches", icon: FileText },
    { label: "Students linked", value: totalStudents, helper: "Across all groups", icon: Users },
    { label: "Join codes", value: groupsWithCodes, helper: "Ready to share", icon: Hash }
  ];

  const createGroup = async event => {
    event.preventDefault();
    try {
      const { data } = await api.post("/admin/groups", newGroup);
      setGroups(current => [...current, data.group].sort((left, right) => left.name.localeCompare(right.name)));
      setNewGroup({ name: "", description: "" });
      await groupDraft.clearDraft();
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
    <div className="adminGroupsShell space-y-6">
      <section className="adminGroupsHeader">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-primary/80">Admin workspace</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-text-primary">Groups</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            Create batches, share join codes, and keep student membership tidy without leaving this page.
          </p>
        </div>
        <div className="adminGroupsRefresh">
          <RefreshStatus
            refreshing={liveRefresh.refreshing}
            lastUpdated={loadedAt || liveRefresh.lastUpdated}
            isStale={liveRefresh.isStale}
            livePaused={livePaused}
            onToggleLive={() => setLivePaused(current => !current)}
            onRefresh={() => loadGroups(true, { force: true })}
          />
        </div>
      </section>

      <div className="adminGroupsStatsBar">
          {summaryCards.map(({ label, value, helper, icon: Icon }) => (
          <div key={label} className="adminGroupsMetric">
            <span className="adminGroupsMetricIcon"><Icon size={17} /></span>
              <div>
                <p>{label}</p>
                <strong>{Number(value || 0).toLocaleString()}</strong>
                <span>{helper}</span>
              </div>
            </div>
          ))}
      </div>

      <div className="adminGroupsLayout">
        <Card className="adminGroupsPanel adminGroupsCreateCard p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="adminGroupsCreateIcon">
              <Plus size={22} />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-text-muted">Group setup</p>
              <h2 className="text-xl font-semibold text-text-primary">Create group</h2>
            </div>
          </div>
          {groupDraft.banner}
          <form onSubmit={createGroup} className="space-y-4">
            <label className="grid gap-2">
              <span className="adminGroupsLabel">Group name <span className="text-danger">*</span></span>
              <input className="adminGroupsField" value={newGroup.name} onChange={event => setNewGroup(current => ({ ...current, name: event.target.value }))} placeholder="Batch A 2026" required />
            </label>
            <label className="grid gap-2">
              <span className="adminGroupsLabel">Description</span>
              <textarea className="adminGroupsField adminGroupsTextarea min-h-28 resize-y" value={newGroup.description} onChange={event => setNewGroup(current => ({ ...current, description: event.target.value }))} rows={3} placeholder="Optional note" />
            </label>
            <button type="submit" className="adminGroupsPrimaryAction">
              <Plus size={18} /> Create Group
            </button>
            <div className="flex justify-end">{groupDraft.indicator}</div>
          </form>
        </Card>

        <div className="space-y-5">
          <Card className="adminGroupsPanel adminGroupsDirectoryCard p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-text-muted">Directory</p>
                <h2 className="mt-1 text-lg font-semibold text-text-primary">Manage existing groups</h2>
              </div>
              <label className="adminGroupsSearch">
                <Search size={18} />
                <input
                  className="adminGroupsSearchInput"
                  value={search}
                  onChange={event => setSearch(event.target.value)}
                  placeholder="Search groups, descriptions, or codes"
                />
              </label>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-text-muted">
              <Badge variant="purple" dot>{filteredGroups.length} shown</Badge>
              {normalizedSearch && <span>Filtered from {groups.length} total groups</span>}
            </div>
          </Card>

          {loading ? (
            <PageLoading title="Loading groups..." />
          ) : filteredGroups.length === 0 ? (
            <EmptyState icon={Search} heading="No groups found" description="Create a group to start assigning students in batches." />
          ) : (
            <div className="adminGroupsList">
              {filteredGroups.map(group => {
                const count = memberCount(group);
                const members = group.members || [];
                const joinCode = String(group.join_code || "--------");
                return (
                <Card key={group.id} className="adminGroupCard">
                  <div className="adminGroupCardHeader">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="adminGroupAvatar">{groupInitial(group.name)}</span>
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold text-text-primary">{group.name}</h2>
                        <p className="mt-1 truncate text-sm text-text-secondary">{group.description || "No description added yet."}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Badge variant={count > 0 ? "success" : "calm"} dot>{studentLabel(count)}</Badge>
                      <Button variant="ghost" size="sm" className="adminGroupRemoveButton" onClick={() => setDeleteTarget(group)} aria-label={`Delete ${group.name}`}>
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>

                  <div className="adminGroupBody">
                    <div className="adminGroupCodePanel">
                      <div className="min-w-0">
                        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-brand-primary/80">
                          <Hash size={14} /> Join code
                        </p>
                        <p className="adminGroupCodeText" aria-label={`Join code ${joinCode}`}>{joinCode}</p>
                      </div>
                      <div className="adminGroupCodeActions">
                        <button type="button" className="adminGroupMiniButton" onClick={() => copyCode(group.join_code)}>
                          <Copy size={16} /> Copy
                        </button>
                        <button type="button" className="adminGroupMiniButton" onClick={() => regenerateCode(group)}>
                          <RefreshCw size={16} /> Regenerate
                        </button>
                      </div>
                    </div>

                    <div className="adminGroupTools">
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                        <label className="grid gap-2">
                          <span className="adminGroupsLabel">Search students</span>
                          <input
                            className="adminGroupsField"
                            value={studentSearches[group.id] || ""}
                            onChange={event => setStudentSearches(current => ({ ...current, [group.id]: event.target.value }))}
                            onKeyDown={event => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                searchStudents(group);
                              }
                            }}
                            placeholder="Search by name, roll, username, or email"
                          />
                        </label>
                        <Button
                          type="button"
                          variant="secondary"
                          className="adminGroupSecondaryButton"
                          loading={searchingGroupId === group.id}
                          loadingLabel="Searching"
                          onClick={() => searchStudents(group)}
                        >
                          <Search size={16} /> Search
                        </Button>
                      </div>
                      {(studentResults[group.id] || []).length > 0 && (
                        <div className="adminGroupSearchResults mt-3">
                          {(studentResults[group.id] || []).map(student => (
                            <button
                              key={student.id}
                              type="button"
                              onClick={() => addStudentToGroup(group, student)}
                              className="adminGroupSearchResult"
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

                      <div className="adminGroupManagementGrid">
                        <label className="grid gap-2">
                          <span className="adminGroupsLabel">Bulk add members</span>
                          <textarea
                            className="adminGroupsField adminGroupsTextarea"
                            value={memberDrafts[group.id] || ""}
                            onChange={event => setMemberDrafts(current => ({ ...current, [group.id]: event.target.value }))}
                            rows={3}
                            placeholder="Roll, username, or email. One per line."
                          />
                        </label>
                        <div>
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <span className="adminGroupsLabel">Members</span>
                            <Button type="button" variant="secondary" size="sm" className="adminGroupSecondaryButton" onClick={() => addMembers(group)}>
                              <UserPlus size={16} /> Add
                            </Button>
                          </div>
                          {members.length > 0 ? (
                            <div className="adminGroupMemberList">
                              {members.map(member => (
                                <div key={member.id} className="adminGroupMemberRow">
                                  <Avatar name={member.name} src={member.profile_picture} size="sm" />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-semibold text-text-primary">{member.name}</p>
                                    <p className="truncate text-xs text-text-muted">{member.roll_number || member.username || "-"} | {member.email || "No email"}</p>
                                  </div>
                                  <Button variant="ghost" size="sm" className="adminGroupRemoveButton" onClick={() => removeMember(group, member)} aria-label="Remove member">
                                    <X size={16} />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="adminGroupEmptyMembers">
                              <Users size={17} />
                              <span>No students yet.</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="adminGroupStatusLine">
                      <span>
                        <CheckCircle2 size={14} className={count > 0 ? "text-success" : "text-text-muted"} />
                        {count > 0 ? "Ready for exam assignment" : "Waiting for members"}
                      </span>
                    </div>
                  </div>
                </Card>
                );
              })}
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
