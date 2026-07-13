import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  doc, onSnapshot, collection, updateDoc, addDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { useSettingsList } from "../../../lib/useSettingsList";
import { PRIORITIES, PROJECT_SOURCES, DEVELOPMENT_TYPES } from "../../../data/staticOptions";
import { PROJECT_STATUSES, PROJECT_PHASES, STATUS_STYLES, PHASE_STYLES, migrateLegacyStatus } from "../../../lib/health";

const DEFAULT_TRAINING_TYPES = ["Onboarding","Compliance & Safety","Technical & Systems","Leadership","Professional Development","Operational Support","L&D Improvements"];
const DEFAULT_DELIVERY_FORMATS = ["Face-to-Face ILT","Virtual ILT","Blended","E-Learning"];

function Field({ label, optional, children }) {
  return (
    <div>
      <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">
        {label} {optional && <span className="text-gray-300 normal-case">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal";

export default function ProjectEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [project, setProject] = useState(null);
  const [users, setUsers] = useState([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

  const [trainingTypes] = useSettingsList("trainingTypes", DEFAULT_TRAINING_TYPES);
  const [deliveryFormats] = useSettingsList("deliveryFormats", DEFAULT_DELIVERY_FORMATS);

  useEffect(() => {
    const unsubP = onSnapshot(doc(db, "projects", id), (snap) => {
      if (!snap.exists()) return;
      const p = { id: snap.id, ...snap.data() };
      setProject(p);
      if (!form) {
        setForm({
          name: p.name || "",
          description: p.description || "",
          ownerId: p.ownerId || "",
          approverId: p.approverId || "",
          priority: p.priority || "Medium",
          trainingType: p.trainingType || "",
          deliveryFormat: p.deliveryFormat || "",
          developmentType: p.developmentType || "",
          smeName: p.smeName || "",
          targetLaunchDate: p.targetLaunchDate || "",
          startDate: p.startDate || "",
          folderUrl: p.folderUrl || "",
          status: PROJECT_STATUSES.includes(p.status) ? p.status : (p.status ? migrateLegacyStatus(p.status).status : "Not Started"),
          phase: PROJECT_PHASES.includes(p.phase) ? p.phase : (p.status ? migrateLegacyStatus(p.status).phase : "Scoping"),
          dueDateApproverId: p.dueDateApproverId || p.ownerId || "",
        });
      }
    });
    const unsubU = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => { unsubP(); unsubU(); };
  }, [id]);

  if (!project || !form) return <p className="text-[13px] text-gray-400 p-6">Loading…</p>;

  const isOwner = project.ownerId === user?.uid;
  const isAdmin = profile?.role === "Admin";
  if (!isOwner && !isAdmin) return <p className="text-[13px] text-red-500 p-6">Access denied.</p>;

  const canEditStartDate = project.baselineStatus !== "Locked";

  const f = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);

    const prevOwner = project.ownerId;
    const newOwner = form.ownerId;
    const prevApprover = project.approverId;
    const newApprover = form.approverId;

    await updateDoc(doc(db, "projects", id), {
      name: (form.name || "").trim(),
      description: (form.description || "").trim(),
      ownerId: newOwner,
      approverId: newApprover,
      dueDateApproverId: form.dueDateApproverId || form.ownerId || null,
      priority: form.priority,
      trainingType: form.trainingType || null,
      deliveryFormat: form.deliveryFormat || null,
      developmentType: form.developmentType || null,
      smeName: (form.smeName || "").trim() || null,
      targetLaunchDate: form.targetLaunchDate || null,
      startDate: form.startDate || null,
      folderUrl: (form.folderUrl || "").trim() || null,
      status: form.status,
      phase: form.phase,
    });

    const nameOf = (uid) => users.find((u) => u.id === uid)?.name || uid;

    const logs = ["Project settings updated."];
    if (prevOwner !== newOwner)
      logs.push(`Ownership transferred from ${nameOf(prevOwner)} to ${nameOf(newOwner)}.`);
    if (prevApprover !== newApprover)
      logs.push(`Approver changed from ${nameOf(prevApprover)} to ${nameOf(newApprover)}.`);

    await addDoc(collection(db, "projects", id, "activity"), {
      type: prevOwner !== newOwner ? "ownership_transfer" : "edit",
      message: logs.join(" "),
      uid: user.uid,
      createdAt: serverTimestamp(),
    });

    setSaving(false);
    navigate(`/projects/${id}`);
  };

  return (
    <div className="max-w-3xl mx-auto pb-16">
      <div className="flex items-center gap-2 mb-6">
        <Link to={`/projects/${id}`} className="text-[11px] text-navy underline">← Back to Project</Link>
      </div>

      <h2 className="text-xl font-bold font-heading text-navy mb-1">Edit Project Settings</h2>
      <p className="text-[12px] text-gray-500 mb-6">{project.name} · {project.projectCode}</p>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 px-6 py-5 space-y-5">

        {/* Name + description */}
        <div className="grid grid-cols-1 gap-4">
          <Field label="Project Name">
            <input type="text" value={form.name} onChange={f("name")} className={inputCls} />
          </Field>
          <Field label="Description" optional>
            <textarea rows={2} value={form.description} onChange={f("description")} className={`${inputCls} resize-none`} />
          </Field>
        </div>

        <hr className="border-gray-100" />

        {/* People */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Owner">
            <select value={form.ownerId} onChange={f("ownerId")} className={inputCls}>
              {users.filter(u => u.role !== "Exec Viewer").map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="Baseline Approver (Supervisor / Manager / Director)">
            <select value={form.approverId} onChange={f("approverId")} className={inputCls}>
              <option value="">— Select Baseline Approver —</option>
              {users
                .filter(u => u.id !== form.ownerId && /supervisor|manager|director/i.test(u.jobTitle || ""))
                .map(u => <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ""}</option>)
              }
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Must be Supervisor, Manager, or Director. Different from Project Lead.</p>
          </Field>
          <Field label="Due Date Change Approver">
            <select value={form.dueDateApproverId} onChange={f("dueDateApproverId")} className={inputCls}>
              <option value="">— Same as Project Owner —</option>
              {users
                .filter(u => /supervisor|manager|director/i.test(u.jobTitle || "") || u.id === form.ownerId)
                .map(u => <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ""}</option>)
              }
            </select>
            <p className="text-[11px] text-gray-400 mt-1">Approves task deadline change requests. Defaults to project owner.</p>
          </Field>
          <Field label="SME Name" optional>
            <input type="text" placeholder="Subject Matter Expert…" value={form.smeName} onChange={f("smeName")} className={inputCls} />
          </Field>
        </div>

        <hr className="border-gray-100" />

        {/* Status + Phase */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Status">
            <select value={form.status} onChange={f("status")} className={inputCls}>
              {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Phase (ADDIE Stage)">
            <select value={form.phase} onChange={f("phase")} className={inputCls}>
              {PROJECT_PHASES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </div>

        <hr className="border-gray-100" />

        {/* Classification */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Priority">
            <select value={form.priority} onChange={f("priority")} className={inputCls}>
              {["Critical","High","Medium","Low"].map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Development Type">
            <select value={form.developmentType} onChange={f("developmentType")} className={inputCls}>
              <option value="">— Select —</option>
              {["Level 1","Level 2","Level 3"].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Training Type">
            <select value={form.trainingType} onChange={f("trainingType")} className={inputCls}>
              <option value="">— Select —</option>
              {trainingTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Delivery Format">
            <select value={form.deliveryFormat} onChange={f("deliveryFormat")} className={inputCls}>
              <option value="">— Select —</option>
              {deliveryFormats.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </Field>
        </div>

        <hr className="border-gray-100" />

        {/* Dates */}
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Target Start Date${!canEditStartDate ? " (locked — baseline approved)" : ""}`}>
            <input
              type="date"
              value={form.startDate}
              onChange={f("startDate")}
              disabled={!canEditStartDate}
              className={`${inputCls} ${!canEditStartDate ? "opacity-50 cursor-not-allowed bg-gray-50" : ""}`}
            />
          </Field>
          <Field label="Target Launch Date" optional>
            <input type="date" value={form.targetLaunchDate} onChange={f("targetLaunchDate")} className={inputCls} />
          </Field>
        </div>

        <hr className="border-gray-100" />

        {/* Links */}
        <Field label="Project Folder URL" optional>
          <input type="url" placeholder="https://…" value={form.folderUrl} onChange={f("folderUrl")} className={inputCls} />
        </Field>

      </div>

      <div className="flex items-center justify-end gap-3 mt-5">
        <Link to={`/projects/${id}`} className="px-5 py-2 text-[13px] border border-gray-300 rounded-md text-gray-600 hover:bg-slate-50">
          Cancel
        </Link>
        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim()}
          className="px-5 py-2 text-[13px] bg-navy text-white rounded-md hover:bg-navy-light disabled:opacity-40"
        >
          {saving ? "Saving…" : "Update Project Settings"}
        </button>
      </div>
    </div>
  );
}
