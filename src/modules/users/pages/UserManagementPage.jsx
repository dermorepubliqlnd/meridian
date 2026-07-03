import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  doc,
  setDoc,
  serverTimestamp,
  getDoc,
  updateDoc,
  arrayUnion,
  getDocs,
  query,
  where,
  addDoc,
  writeBatch,
} from "firebase/firestore";
import { db, createUserWithoutSignIn } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { useSettingsList } from "../../../lib/useSettingsList";
import { userWeeklyProjectHours } from "../../../lib/bandwidth";

const SYSTEM_ROLES = ["Admin", "Contributor", "Exec Viewer"];

function genTempPassword() {
  return "Md" + Math.random().toString(36).slice(-8) + "!1";
}

// ── Capacity badge ────────────────────────────────────────────────────────────
function CapacityBadge({ user }) {
  const weekly = user.weeklyHours ?? 37.5;
  const pct    = user.projectCapacityPct ?? 60;
  const projHrs = Math.round(userWeeklyProjectHours(user) * 10) / 10;
  return (
    <div>
      <span className="text-[13px] font-medium text-navy">{projHrs}h</span>
      <span className="text-[11px] text-gray-400"> /wk project</span>
      <div className="text-[10px] text-gray-400 mt-0.5">{weekly}h total · {pct}% project capacity</div>
    </div>
  );
}

// ── Edit row ──────────────────────────────────────────────────────────────────
function EditUserRow({ user, users, jobTitles, onCancel, onSaved }) {
  const [edit, setEdit] = useState({
    name:               user.name               || "",
    jobTitle:           user.jobTitle           || "",
    reportsTo:          user.reportsTo          || "",
    role:               user.role               || "Contributor",
    weeklyHours:        user.weeklyHours        ?? 37.5,
    projectCapacityPct: user.projectCapacityPct ?? 60,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await updateDoc(doc(db, "users", user.id), {
      name:               edit.name,
      jobTitle:           edit.jobTitle,
      reportsTo:          edit.reportsTo || null,
      role:               edit.role,
      weeklyHours:        Number(edit.weeklyHours),
      projectCapacityPct: Number(edit.projectCapacityPct),
    });
    setSaving(false);
    onSaved();
  };

  const projHrs = Math.round(Number(edit.weeklyHours) * (Number(edit.projectCapacityPct) / 100) * 10) / 10;

  return (
    <tr className="border-t border-gray-100 bg-slate-50">
      {/* Name */}
      <td className="px-3 py-2">
        <input
          value={edit.name}
          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
        />
        <div className="text-xs text-gray-400 mt-1">{user.email}</div>
      </td>
      {/* Job Title */}
      <td className="px-3 py-2">
        <select
          value={edit.jobTitle}
          onChange={(e) => setEdit({ ...edit, jobTitle: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
        >
          <option value="">—</option>
          {jobTitles.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </td>
      {/* Reports To */}
      <td className="px-3 py-2">
        <select
          value={edit.reportsTo}
          onChange={(e) => setEdit({ ...edit, reportsTo: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
        >
          <option value="">No one</option>
          {users.filter((u) => u.id !== user.id).map((u) => (
            <option key={u.id} value={u.id}>{u.name}</option>
          ))}
        </select>
      </td>
      {/* System Role */}
      <td className="px-3 py-2">
        <select
          value={edit.role}
          onChange={(e) => setEdit({ ...edit, role: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-sm"
        >
          {SYSTEM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </td>
      {/* Capacity */}
      <td className="px-3 py-2">
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-gray-400 w-20">Weekly hrs</label>
            <input
              type="number" min="1" max="60" step="0.5"
              value={edit.weeklyHours}
              onChange={(e) => setEdit({ ...edit, weeklyHours: e.target.value })}
              className="w-16 border border-gray-300 rounded px-1.5 py-0.5 text-[12px]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label className="text-[10px] text-gray-400 w-20">Project cap %</label>
            <input
              type="number" min="10" max="100" step="5"
              value={edit.projectCapacityPct}
              onChange={(e) => setEdit({ ...edit, projectCapacityPct: e.target.value })}
              className="w-16 border border-gray-300 rounded px-1.5 py-0.5 text-[12px]"
            />
          </div>
          <div className="text-[10px] text-teal-600">→ {projHrs}h/wk for projects</div>
        </div>
      </td>
      {/* Actions */}
      <td className="px-3 py-2 whitespace-nowrap">
        <button
          onClick={save}
          disabled={saving}
          className="text-xs bg-navy text-white px-2 py-1 rounded-md mr-2 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500">Cancel</button>
      </td>
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function UserManagementPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState([]);
  const [jobTitles] = useSettingsList("jobTitles", ["Content Developer", "Instructional Designer", "L&D Director", "L&D Supervisor", "Trainer"]);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({
    name: "", email: "", role: "Contributor", jobTitle: "", reportsTo: "",
  });
  const [status,     setStatus]     = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  const isAdmin = profile?.role === "Admin";
  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);
    setSubmitting(true);
    const tempPassword = genTempPassword();
    try {
      const uid = await createUserWithoutSignIn(form.email, tempPassword);
      await setDoc(doc(db, "users", uid), {
        name:               form.name,
        email:              form.email,
        role:               form.role,
        jobTitle:           form.jobTitle,
        reportsTo:          form.reportsTo || null,
        weeklyHours:        37.5,   // Phase 1 default
        projectCapacityPct: 60,     // Phase 1 default — edit per person after adding
        createdAt:          serverTimestamp(),
      });
      setStatus({
        type: "success",
        message: `${form.name} added. Temp password: ${tempPassword} · Default capacity: 37.5h/wk, 60% project time (edit to adjust).`,
      });
      setForm({ name: "", email: "", role: "Contributor", jobTitle: "", reportsTo: "" });
    } catch (err) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (targetUser) => {
    const reactivating = targetUser.isActive === false;
    if (!reactivating && !window.confirm(
      `Deactivate ${targetUser.name}? Their owned projects will be transferred to an Admin automatically.`
    )) return;

    await updateDoc(doc(db, "users", targetUser.id), { isActive: reactivating ? true : false });

    if (!reactivating) {
      const adminUser = users.find((u) => u.role === "Admin" && u.id !== targetUser.id);
      if (!adminUser) return;
      const projSnap = await getDocs(
        query(collection(db, "projects"), where("ownerId", "==", targetUser.id))
      );
      if (projSnap.empty) return;
      const batch = writeBatch(db);
      projSnap.docs.forEach((pDoc) => batch.update(pDoc.ref, { ownerId: adminUser.id }));
      await batch.commit();
      for (const pDoc of projSnap.docs) {
        await addDoc(collection(db, "projects", pDoc.id, "activity"), {
          type: "ownership_transfer",
          message: `Ownership transferred from ${targetUser.name} to ${adminUser.name} — ${targetUser.name} was deactivated.`,
          uid: profile?.uid || "system",
          createdAt: serverTimestamp(),
        });
      }
    }
  };

  if (!isAdmin) {
    return (
      <div>
        <h2 className="text-xl font-bold font-heading text-navy mb-0.5">User Management</h2>
        <p className="text-sm text-gray-500">Only Admins can manage users.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-xl font-bold font-heading text-navy mb-0.5">User Management</h2>
      <p className="text-xs text-gray-500 mb-4">
        Add team members, assign job title, reporting line, system role, and capacity profile.
        Capacity defaults to 37.5h/wk total · 60% project time — edit each person to reflect their actual availability.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* ── Add User form ── */}
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 space-y-2.5 lg:col-span-1 h-fit"
        >
          <h3 className="font-semibold text-navy text-sm mb-2">Add User</h3>
          <input
            type="text" placeholder="Full name" value={form.name} required
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
          />
          <input
            type="email" placeholder="Work email" value={form.email} required
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
          />
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Job Title</label>
            <select
              value={form.jobTitle} required
              onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            >
              <option value="" disabled>Select job title</option>
              {jobTitles.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Manage job titles in Admin Settings → Job Titles.</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Reports To</label>
            <select
              value={form.reportsTo}
              onChange={(e) => setForm({ ...form, reportsTo: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            >
              <option value="">No one / Top of hierarchy</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">System Role</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            >
              {SYSTEM_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="bg-slate-50 border border-gray-200 rounded-md p-2.5 text-[11px] text-gray-500">
            Capacity defaults to <strong>37.5h/wk · 60% project time</strong> (22.5h available for projects). Edit the person after adding to adjust.
          </div>
          <button
            type="submit" disabled={submitting}
            className="w-full bg-navy text-white rounded-md py-2 text-sm font-medium hover:bg-navy-light transition disabled:opacity-50"
          >
            {submitting ? "Adding..." : "Add User"}
          </button>
          {status && (
            <p className={`text-xs ${status.type === "success" ? "text-teal-700" : "text-red-500"}`}>
              {status.message}
            </p>
          )}
        </form>

        {/* ── User table ── */}
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-slate-50 text-left text-[10px] text-gray-400 uppercase tracking-wide font-medium">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Job Title</th>
                <th className="px-3 py-2">Reports To</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Project Capacity</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) =>
                editingId === u.id ? (
                  <EditUserRow
                    key={u.id}
                    user={u}
                    users={users}
                    jobTitles={jobTitles}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => setEditingId(null)}
                  />
                ) : (
                  <tr key={u.id} className="border-t border-gray-100 hover:bg-slate-50/50">
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={u.isActive === false ? "text-gray-400 line-through" : ""}>{u.name}</span>
                        {u.isActive === false && (
                          <span className="text-[10px] bg-red-100 text-red-600 rounded px-1">Inactive</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400">{u.email}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-600">{u.jobTitle || "—"}</td>
                    <td className="px-3 py-2 text-gray-600">{u.reportsTo ? nameFor(u.reportsTo) : "—"}</td>
                    <td className="px-3 py-2">
                      <span className="bg-teal/10 text-teal-700 px-1.5 py-0.5 rounded text-[11px] font-medium">
                        {u.role}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <CapacityBadge user={u} />
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setEditingId(u.id)}
                          className="text-xs text-navy underline"
                        >
                          Edit
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleDeactivate(u)}
                            className={`text-xs underline ${u.isActive === false ? "text-teal-600" : "text-red-400"}`}
                          >
                            {u.isActive === false ? "Reactivate" : "Deactivate"}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              )}
              {users.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-gray-400">No users yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
