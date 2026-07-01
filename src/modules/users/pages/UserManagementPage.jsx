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
} from "firebase/firestore";
import { db, createUserWithoutSignIn } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";

const SYSTEM_ROLES = ["Admin", "Contributor", "Exec Viewer"];
const JOB_TITLES_DOC = doc(db, "settings", "jobTitles");

function genTempPassword() {
  return "Md" + Math.random().toString(36).slice(-8) + "!1";
}

export default function UserManagementPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState([]);
  const [jobTitles, setJobTitles] = useState([]);
  const [newTitle, setNewTitle] = useState("");
  const [form, setForm] = useState({
    name: "",
    email: "",
    role: "Contributor",
    jobTitle: "",
    reportsTo: "",
  });
  const [status, setStatus] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  useEffect(() => {
    const load = async () => {
      const snap = await getDoc(JOB_TITLES_DOC);
      if (snap.exists()) {
        setJobTitles(snap.data().titles || []);
      } else {
        const defaults = [
          "L&D Director",
          "L&D Supervisor",
          "Instructional Designer",
          "Content Developer",
          "Trainer",
        ];
        await setDoc(JOB_TITLES_DOC, { titles: defaults });
        setJobTitles(defaults);
      }
    };
    load();
  }, []);

  const isAdmin = profile?.role === "Admin";

  const addJobTitle = async () => {
    const title = newTitle.trim();
    if (!title || jobTitles.includes(title)) return;
    await updateDoc(JOB_TITLES_DOC, { titles: arrayUnion(title) });
    setJobTitles((prev) => [...prev, title]);
    setForm((f) => ({ ...f, jobTitle: title }));
    setNewTitle("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus(null);
    setSubmitting(true);
    const tempPassword = genTempPassword();
    try {
      const uid = await createUserWithoutSignIn(form.email, tempPassword);
      await setDoc(doc(db, "users", uid), {
        name: form.name,
        email: form.email,
        role: form.role,
        jobTitle: form.jobTitle,
        reportsTo: form.reportsTo || null,
        createdAt: serverTimestamp(),
      });
      setStatus({
        type: "success",
        message: `${form.name} added. Share this temporary password with them: ${tempPassword}`,
      });
      setForm({ name: "", email: "", role: "Contributor", jobTitle: "", reportsTo: "" });
    } catch (err) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";

  if (!isAdmin) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-navy mb-1">User Management</h2>
        <p className="text-sm text-gray-500">Only Admins can manage users.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-navy mb-1">User Management</h2>
      <p className="text-sm text-gray-500 mb-6">
        Add team members, assign their job title, reporting line, and system role.
        Meridian is invite-only — there is no public sign-up.
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 space-y-3 lg:col-span-1 h-fit"
        >
          <h3 className="font-semibold text-navy text-sm mb-2">Add User</h3>
          <input
            type="text"
            placeholder="Full name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            required
          />
          <input
            type="email"
            placeholder="Work email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            required
          />

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Job Title</label>
            <select
              value={form.jobTitle}
              onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              required
            >
              <option value="" disabled>
                Select job title
              </option>
              {jobTitles.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                placeholder="Add new job title..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-teal"
              />
              <button
                type="button"
                onClick={addJobTitle}
                className="text-xs bg-slate-100 text-navy px-2 py-1 rounded-md hover:bg-slate-200"
              >
                + Add
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Reports To</label>
            <select
              value={form.reportsTo}
              onChange={(e) => setForm({ ...form, reportsTo: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            >
              <option value="">No one / Top of hierarchy</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">System Role</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            >
              {SYSTEM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-navy text-white rounded-md py-2 text-sm font-medium hover:bg-navy-light transition disabled:opacity-50"
          >
            {submitting ? "Adding..." : "Add User"}
          </button>
          {status && (
            <p
              className={`text-xs ${
                status.type === "success" ? "text-teal-700" : "text-red-500"
              }`}
            >
              {status.message}
            </p>
          )}
        </form>

        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-gray-400 uppercase">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Job Title</th>
                <th className="px-4 py-3">Reports To</th>
                <th className="px-4 py-3">System Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="px-4 py-3">
                    <div>{u.name}</div>
                    <div className="text-xs text-gray-400">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{u.jobTitle || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {u.reportsTo ? nameFor(u.reportsTo) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="bg-teal/10 text-teal-700 px-2 py-1 rounded text-xs font-medium">
                      {u.role}
                    </span>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-gray-400">
                    No users yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
