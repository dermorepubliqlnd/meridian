import { useEffect, useState } from "react";
import { collection, onSnapshot, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db, createUserWithoutSignIn } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";

const ROLES = ["Admin", "Contributor", "Exec Viewer"];

function genTempPassword() {
  return "Md" + Math.random().toString(36).slice(-8) + "!1";
}

export default function UserManagementPage() {
  const { profile } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({ name: "", email: "", role: "Contributor" });
  const [status, setStatus] = useState(null); // { type: 'success'|'error', message }
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  const isAdmin = profile?.role === "Admin";

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
        createdAt: serverTimestamp(),
      });
      setStatus({
        type: "success",
        message: `${form.name} added. Share this temporary password with them: ${tempPassword}`,
      });
      setForm({ name: "", email: "", role: "Contributor" });
    } catch (err) {
      setStatus({ type: "error", message: err.message });
    } finally {
      setSubmitting(false);
    }
  };

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
        Add team members and assign their role. Meridian is invite-only — there is no public
        sign-up.
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
          <select
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value })}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
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
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Role</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-gray-100">
                  <td className="px-4 py-3">{u.name}</td>
                  <td className="px-4 py-3 text-gray-500">{u.email}</td>
                  <td className="px-4 py-3">
                    <span className="bg-teal/10 text-teal-700 px-2 py-1 rounded text-xs font-medium">
                      {u.role}
                    </span>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-gray-400">
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
