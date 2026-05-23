import { useEffect, useState } from "react";
import { Plus, Search, Trash2, Users } from "lucide-react";
import { Badge, Button, Card, ConfirmationDialog, EmptyState, Input, Textarea } from "../components/ui";
import { notify } from "../components/ui/Toast";

function parseGroups(html) {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll(".question-bank-item")).map((node, index) => {
    const addAction = node.querySelector("form[action*='/members']")?.getAttribute("action") || "";
    const deleteAction = node.querySelector("form[action*='/delete']")?.getAttribute("action") || "";
    const id = (addAction || deleteAction).match(/groups\/(\d+)/)?.[1] || `group-${index}`;
    return {
      id,
      name: node.querySelector("h3")?.textContent.trim() || "Student Group",
      description: node.querySelector("p.muted")?.textContent.trim() || "No description",
      count: node.querySelector(".badge")?.textContent.trim() || "0 students",
      addAction,
      deleteAction,
      members: Array.from(node.querySelectorAll("tbody tr")).map(row => {
        const cells = Array.from(row.querySelectorAll("td")).map(cell => cell.textContent.trim());
        return { name: cells[0], roll: cells[1], email: cells[2] };
      })
    };
  });
}

export default function AdminGroups() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [adminPassword, setAdminPassword] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadGroups() {
      try {
        const response = await window.fetch("/admin/groups", { credentials: "same-origin" });
        const html = await response.text();
        if (!cancelled) setGroups(parseGroups(html));
      } catch {
        notify.warning("Open the classic groups page for the live group list.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadGroups();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredGroups = groups.filter(group => group.name.toLowerCase().includes(search.toLowerCase()));

  const confirmDelete = async () => {
    if (!deleteTarget?.deleteAction || !adminPassword) return;
    const formData = new window.FormData();
    formData.append("admin_password", adminPassword);
    try {
      const response = await window.fetch(deleteTarget.deleteAction, {
        method: "POST",
        credentials: "same-origin",
        body: formData
      });
      if (!response.ok) throw new Error("Delete failed");
      setGroups(current => current.filter(group => group.id !== deleteTarget.id));
      notify.success("Group deleted");
      setDeleteTarget(null);
      setAdminPassword("");
    } catch {
      notify.error("Could not delete group. Check the admin password.");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase text-text-muted">Admin workspace</p>
          <h1 className="text-3xl font-bold text-text-primary">Groups</h1>
          <p className="mt-1 text-text-secondary">Create student batches and manage roster membership with the existing group endpoints.</p>
        </div>
        <Button as="a" href="/admin/groups" variant="secondary">
          <Users size={18} /> Classic Groups
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-lg bg-brand-primary/10 text-brand-primary">
              <Plus size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Create Group</h2>
              <p className="text-sm text-text-secondary">New groups are saved directly to Flask.</p>
            </div>
          </div>
          <form method="post" action="/admin/groups" className="space-y-4">
            <Input label="Group Name" name="name" placeholder="Batch A 2026" required />
            <Textarea label="Description" name="description" rows={3} placeholder="Optional note" />
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
                      <p className="text-sm text-text-secondary">{group.description}</p>
                    </div>
                    <Badge variant="info">{group.count}</Badge>
                  </div>

                  <form method="post" action={group.addAction} className="space-y-3 rounded-lg border border-border bg-background-base p-3">
                    <Textarea label="Add Members" name="members" rows={4} placeholder="Paste roll number, username, or email, one per line" />
                    <Button type="submit" variant="secondary" size="sm">
                      <Plus size={16} /> Add Students
                    </Button>
                  </form>

                  {group.members.length > 0 && (
                    <div className="mt-4 max-h-48 overflow-auto rounded-lg border border-border">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-background-elevated text-text-secondary">
                          <tr>
                            <th className="px-3 py-2">Name</th>
                            <th className="px-3 py-2">Roll</th>
                            <th className="px-3 py-2">Email</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {group.members.map(member => (
                            <tr key={`${member.roll}-${member.email}`}>
                              <td className="px-3 py-2 text-text-primary">{member.name}</td>
                              <td className="px-3 py-2 text-text-secondary">{member.roll}</td>
                              <td className="px-3 py-2 text-text-secondary">{member.email}</td>
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
            <Input
              label="Admin Password"
              type="password"
              value={adminPassword}
              onChange={event => setAdminPassword(event.target.value)}
              placeholder="Required by Flask"
            />
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
