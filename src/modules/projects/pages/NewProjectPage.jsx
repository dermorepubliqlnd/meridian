import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  onSnapshot,
  addDoc,
  writeBatch,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { WBS_TEMPLATES } from "../../../data/wbsTemplates";

export default function NewProjectPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState({
    name: "",
    description: "",
    templateId: WBS_TEMPLATES[0].id,
    startDate: "",
    baselineEndDate: "",
    ownerId: "",
    memberIds: [],
    folderUrl: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  const selectedTemplate = WBS_TEMPLATES.find((t) => t.id === form.templateId);
  const totalTasks = selectedTemplate.phases.reduce((n, p) => n + p.tasks.length, 0);
  const totalEstDays = selectedTemplate.phases.reduce(
    (n, p) => n + p.tasks.reduce((m, t) => m + t.estDays, 0),
    0
  );

  const toggleMember = (uid) => {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(uid)
        ? f.memberIds.filter((id) => id !== uid)
        : [...f.memberIds, uid],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.ownerId) {
      setError("Please assign a Project Owner.");
      return;
    }
    if (!form.baselineEndDate) {
      setError("Please set a Baseline End Date. Once saved, this cannot be changed directly.");
      return;
    }
    setSubmitting(true);
    try {
      const projectRef = await addDoc(collection(db, "projects"), {
        name: form.name,
        description: form.description,
        templateId: form.templateId,
        templateName: selectedTemplate.name,
        startDate: form.startDate,
        baselineEndDate: form.baselineEndDate,
        approvedRevisedEndDate: null,
        actualCompletionDate: null,
        ownerId: form.ownerId,
        memberIds: Array.from(new Set([...form.memberIds, form.ownerId])),
        folderUrl: form.folderUrl || null,
        status: "Not Started",
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      const batch = writeBatch(db);
      let order = 0;
      selectedTemplate.phases.forEach((phase) => {
        phase.tasks.forEach((task) => {
          order += 1;
          const taskRef = doc(collection(db, "projects", projectRef.id, "tasks"));
          batch.set(taskRef, {
            phase: phase.phase,
            name: task.name,
            notes: task.notes,
            responsibleRole: task.role,
            assigneeId: null,
            estimatedDays: task.estDays,
            estimatedHours: null,
            startDate: null,
            dueDate: null,
            status: "Not Started",
            blockedBy: [],
            order,
          });
        });
      });
      await batch.commit();

      navigate(`/projects/${projectRef.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold font-heading text-navy mb-0.5">New Project</h2>
      <p className="text-xs text-gray-500 mb-4">
        Pick a WBS template to auto-generate the task list. The Baseline End Date locks once
        saved — future changes go through the deadline change request process.
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-100 p-4 space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Project Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              required
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">WBS Template</label>
            <select
              value={form.templateId}
              onChange={(e) => setForm({ ...form, templateId: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            >
              {WBS_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">{selectedTemplate.description}</p>
            <p className="text-xs text-teal-700 mt-1">
              {totalTasks} tasks across {selectedTemplate.phases.length} phases · ~{totalEstDays}{" "}
              estimated days (reference only — real dates come from hours logged in Tasks)
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Start Date</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                required
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">
                Baseline End Date <span className="text-red-500">(locks after save)</span>
              </label>
              <input
                type="date"
                value={form.baselineEndDate}
                onChange={(e) => setForm({ ...form, baselineEndDate: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block">Project Folder URL (optional)</label>
            <input
              type="url"
              placeholder="https://..."
              value={form.folderUrl}
              onChange={(e) => setForm({ ...form, folderUrl: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
        </div>

        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5">
            <label className="text-xs text-gray-500 mb-1 block">Project Owner</label>
            <select
              value={form.ownerId}
              onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              required
            >
              <option value="" disabled>
                Select Project Owner
              </option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.jobTitle ? `— ${u.jobTitle}` : ""}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Any Admin or Contributor can be Project Owner here, regardless of job title.
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5">
            <label className="text-xs text-gray-500 mb-2 block">Team Members (Contributors)</label>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm py-1">
                  <input
                    type="checkbox"
                    checked={form.memberIds.includes(u.id)}
                    onChange={() => toggleMember(u.id)}
                  />
                  {u.name}
                </label>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              Invite-only — only people checked here (plus the Owner) can see this project.
            </p>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-navy text-white rounded-md py-2.5 text-sm font-medium hover:bg-navy-light transition disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Project"}
          </button>
        </div>
      </form>
    </div>
  );
}
