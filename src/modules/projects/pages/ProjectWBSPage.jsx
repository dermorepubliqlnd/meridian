import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import {
  doc,
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  addDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { computeRollups } from "../../../lib/completion";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  "Project Owner",
  "Instructional Designer",
  "Content Developer",
  "QA Reviewer",
  "SME",
  "L&D Supervisor",
];

const PLANNING_STATUS_COLORS = {
  "Draft / Intake": "bg-gray-100 text-gray-600",
  "WBS Pending": "bg-blue-100 text-blue-700",
  "Resource Check": "bg-yellow-100 text-yellow-700",
  "Approved": "bg-green-100 text-green-700",
  "Active": "bg-teal-100 text-teal-700",
};

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2800);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-gray-900 text-white text-[13px] px-4 py-2.5 rounded-xl shadow-lg">
      <span className="text-teal-400">&#10003;</span>
      {message}
    </div>
  );
}

// ─── Inline editable text cell ────────────────────────────────────────────────

function EditableText({ value, onSave, placeholder = "—", multiline = false, className = "" }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || "");
  const ref = useRef(null);

  useEffect(() => {
    if (editing && ref.current) ref.current.focus();
  }, [editing]);

  function handleBlur() {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed !== (value || "").trim()) onSave(trimmed);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !multiline) { e.preventDefault(); ref.current?.blur(); }
    if (e.key === "Escape") { setDraft(value || ""); setEditing(false); }
  }

  if (editing) {
    const shared = {
      ref,
      value: draft,
      onChange: (e) => setDraft(e.target.value),
      onBlur: handleBlur,
      onKeyDown: handleKeyDown,
      className: `w-full border border-gray-200 rounded-lg px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal-400 ${className}`,
    };
    return multiline
      ? <textarea {...shared} rows={2} />
      : <input {...shared} type="text" />;
  }

  return (
    <span
      onClick={() => { setDraft(value || ""); setEditing(true); }}
      className={`cursor-text group inline-flex items-center gap-1 ${className}`}
      title="Click to edit"
    >
      <span className={value ? "" : "text-gray-300 italic"}>{value || placeholder}</span>
      <svg className="w-3 h-3 text-gray-300 group-hover:text-teal-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z" />
      </svg>
    </span>
  );
}

// ─── Hours input ──────────────────────────────────────────────────────────────

function HoursInput({ value, onSave }) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");

  useEffect(() => {
    setDraft(value != null ? String(value) : "");
  }, [value]);

  function handleBlur() {
    const parsed = parseFloat(draft);
    const next = isNaN(parsed) ? null : parsed;
    if (next !== value) onSave(next);
  }

  return (
    <input
      type="number"
      min="0"
      step="0.5"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={handleBlur}
      placeholder="—"
      className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-[12px] text-center focus:outline-none focus:ring-1 focus:ring-teal-400"
    />
  );
}

// ─── Role select pill ─────────────────────────────────────────────────────────

function RoleSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pillClass = value
    ? "bg-teal-50 border border-teal-200 text-teal-800 text-[11px] rounded-full px-2.5 py-0.5 cursor-pointer whitespace-nowrap"
    : "border border-dashed border-gray-300 text-gray-400 text-[11px] rounded-full px-2.5 py-0.5 cursor-pointer whitespace-nowrap";

  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} className={pillClass}>
        {value || "Select role"}
      </button>
      {open && (
        <div className="absolute z-30 top-full left-0 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg min-w-[180px] py-1 text-[12px]">
          <button
            className="w-full text-left px-3 py-1.5 hover:bg-gray-50 text-gray-400 italic"
            onClick={() => { onChange(""); setOpen(false); }}
          >
            None
          </button>
          {ROLE_OPTIONS.map((r) => (
            <button
              key={r}
              className={`w-full text-left px-3 py-1.5 hover:bg-teal-50 hover:text-teal-700 ${value === r ? "bg-teal-50 text-teal-700 font-medium" : "text-gray-700"}`}
              onClick={() => { onChange(r); setOpen(false); }}
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4 flex flex-col gap-1">
      <span className="text-[11px] text-gray-500 font-medium uppercase tracking-wide">{label}</span>
      <span className="text-2xl font-bold text-gray-800">{value}</span>
      {sub && <span className="text-[11px] text-gray-400">{sub}</span>}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectWBSPage() {
  const { id } = useParams();
  const { user } = useAuth();

  const [project, setProject] = useState(undefined); // undefined = loading, null = not found
  const [tasks, setTasks] = useState(null);
  const [toast, setToast] = useState(null);
  const [savingIds, setSavingIds] = useState(new Set());

  // ── Firestore subscriptions ────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, "projects", id), (snap) => {
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    return unsub;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, "projects", id, "tasks"), orderBy("order", "asc"));
    const unsub = onSnapshot(q, (snap) => {
      setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [id]);

  // ── Derived state (ALL useMemo before early returns) ───────────────────────

  const topLevelTasks = useMemo(
    () => (tasks || []).filter((t) => !t.parentTaskId),
    [tasks]
  );

  const subtaskMap = useMemo(() => {
    const map = {};
    (tasks || []).forEach((t) => {
      if (t.parentTaskId) {
        if (!map[t.parentTaskId]) map[t.parentTaskId] = [];
        map[t.parentTaskId].push(t);
      }
    });
    return map;
  }, [tasks]);

  const phases = useMemo(() => {
    const seen = new Set();
    const ordered = [];
    topLevelTasks.forEach((t) => {
      const ph = t.phase || "General";
      if (!seen.has(ph)) { seen.add(ph); ordered.push(ph); }
    });
    return ordered;
  }, [topLevelTasks]);

  const stats = useMemo(() => {
    const all = tasks || [];
    const totalTasks = all.length;
    const totalEffort = topLevelTasks.reduce((s, t) => s + (t.estimatedHours || 0), 0);
    const uniqueRoles = new Set(
      topLevelTasks.map((t) => t.responsibleRole).filter(Boolean)
    ).size;
    const doneTasks = all.filter((t) => t.status === "Done").length;
    const completion = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    return { totalTasks, totalEffort, uniqueRoles, completion };
  }, [tasks, topLevelTasks]);

  const phaseHours = useMemo(() => {
    const map = {};
    topLevelTasks.forEach((t) => {
      const ph = t.phase || "General";
      map[ph] = (map[ph] || 0) + (t.estimatedHours || 0);
    });
    return map;
  }, [topLevelTasks]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const showToast = useCallback((msg) => setToast(msg), []);

  const markSaving = useCallback((taskId) => {
    setSavingIds((s) => new Set([...s, taskId]));
  }, []);

  const clearSaving = useCallback((taskId) => {
    setSavingIds((s) => { const n = new Set(s); n.delete(taskId); return n; });
  }, []);

  const checkPlanningStatus = useCallback(
    async (currentProject, currentTopLevel) => {
      if (!currentProject) return;
      const allFilled = currentTopLevel.every(
        (t) => t.estimatedHours > 0 && t.responsibleRole
      );
      if (allFilled && currentTopLevel.length > 0 && currentProject.planningStatus === "Draft / Intake") {
        try {
          await updateDoc(doc(db, "projects", id), { planningStatus: "WBS Pending" });
          showToast("WBS complete — ready for resource check.");
        } catch (e) {
          console.error("planningStatus update failed", e);
        }
      }
    },
    [id, showToast]
  );

  const saveTaskField = useCallback(
    async (taskId, fields) => {
      markSaving(taskId);
      try {
        await updateDoc(doc(db, "projects", id, "tasks", taskId), fields);
      } catch (e) {
        console.error("saveTaskField error", e);
        showToast("Save failed — please try again.");
      } finally {
        clearSaving(taskId);
      }
    },
    [id, markSaving, clearSaving, showToast]
  );

  // After any task update, re-evaluate planning status (debounced)
  const planningCheckPending = useRef(false);
  useEffect(() => {
    if (!tasks || !project || planningCheckPending.current) return;
    planningCheckPending.current = true;
    const t = setTimeout(() => {
      checkPlanningStatus(project, topLevelTasks);
      planningCheckPending.current = false;
    }, 800);
    return () => clearTimeout(t);
  }, [tasks, project, topLevelTasks, checkPlanningStatus]);

  async function addTask(phase) {
    const phaseTasks = topLevelTasks.filter((t) => (t.phase || "General") === phase);
    const maxOrder = phaseTasks.length > 0
      ? Math.max(...phaseTasks.map((t) => t.order ?? 0))
      : (tasks || []).length;
    try {
      await addDoc(collection(db, "projects", id, "tasks"), {
        name: "New Task",
        phase,
        notes: "",
        responsibleRole: "",
        estimatedHours: null,
        actualHours: null,
        status: "Not Started",
        parentTaskId: null,
        order: maxOrder + 1,
        dueDate: null,
        startDate: null,
        actualCompletionDate: null,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("addTask error", e);
      showToast("Could not add task.");
    }
  }

  async function addSubtask(parentTask) {
    const siblings = subtaskMap[parentTask.id] || [];
    const maxOrder = siblings.length > 0
      ? Math.max(...siblings.map((t) => t.order ?? 0))
      : parentTask.order + 0.5;
    try {
      await addDoc(collection(db, "projects", id, "tasks"), {
        name: "New Subtask",
        phase: parentTask.phase || "General",
        notes: "",
        responsibleRole: "",
        estimatedHours: null,
        actualHours: null,
        status: "Not Started",
        parentTaskId: parentTask.id,
        order: maxOrder + 0.1,
        dueDate: null,
        startDate: null,
        actualCompletionDate: null,
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.error("addSubtask error", e);
      showToast("Could not add subtask.");
    }
  }

  async function addGlobalTask() {
    const defaultPhase = phases.length > 0 ? phases[0] : "General";
    await addTask(defaultPhase);
  }

  async function deleteTask(task) {
    const label = task.name || "this task";
    const subs = subtaskMap[task.id] || [];
    const confirmMsg = subs.length > 0
      ? `Delete "${label}" and its ${subs.length} subtask(s)? This cannot be undone.`
      : `Delete "${label}"? This cannot be undone.`;
    if (!window.confirm(confirmMsg)) return;
    try {
      await Promise.all(subs.map((s) => deleteDoc(doc(db, "projects", id, "tasks", s.id))));
      await deleteDoc(doc(db, "projects", id, "tasks", task.id));
    } catch (e) {
      console.error("deleteTask error", e);
      showToast("Delete failed.");
    }
  }

  // ── WBS numbering ──────────────────────────────────────────────────────────

  function getWbsNumber(phase, taskId) {
    const phaseTasks = topLevelTasks.filter((t) => (t.phase || "General") === phase);
    const parentIdx = phaseTasks.findIndex((t) => t.id === taskId);
    if (parentIdx !== -1) return `${parentIdx + 1}.0`;

    const task = (tasks || []).find((t) => t.id === taskId);
    if (!task?.parentTaskId) return "—";
    const parentTask = topLevelTasks.find((t) => t.id === task.parentTaskId);
    if (!parentTask) return "—";
    const parentPhase = parentTask.phase || "General";
    const phaseParents = topLevelTasks.filter((t) => (t.phase || "General") === parentPhase);
    const parentNum = phaseParents.findIndex((t) => t.id === task.parentTaskId) + 1;
    const siblings = subtaskMap[task.parentTaskId] || [];
    const subIdx = siblings.findIndex((s) => s.id === taskId) + 1;
    return `${parentNum}.${subIdx}`;
  }

  // ── Early returns (AFTER all hooks) ───────────────────────────────────────

  if (project === undefined || tasks === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Loading WBS...</div>
      </div>
    );
  }

  if (project === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Project not found.</div>
      </div>
    );
  }

  const planningPillClass =
    PLANNING_STATUS_COLORS[project.planningStatus] || "bg-gray-100 text-gray-600";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">

        {/* Back link */}
        <Link
          to={`/projects/${id}`}
          className="inline-flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-teal-600 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Project
        </Link>

        {/* Header card */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-6 py-5">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900">{project.name}</h1>
                {project.projectCode && (
                  <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-full border border-gray-200 text-gray-600 bg-gray-50">
                    {project.projectCode}
                  </span>
                )}
                {project.ticketNumber && (
                  <span className="bg-gray-100 text-[11px] font-mono px-2 py-0.5 rounded-full text-gray-500">
                    #{project.ticketNumber}
                  </span>
                )}
              </div>
              <p className="text-[13px] text-gray-500">
                Assign estimated hours and required roles to each WBS task. Role demand will be calculated automatically.
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              {project.planningStatus && (
                <span className={`text-[12px] font-medium px-3 py-1 rounded-full ${planningPillClass}`}>
                  {project.planningStatus}
                </span>
              )}
              <button
                onClick={addGlobalTask}
                className="inline-flex items-center gap-1.5 bg-teal-500 hover:bg-teal-600 text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                Add Task
              </button>
            </div>
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Tasks" value={stats.totalTasks} sub="all tasks + subtasks" />
          <StatCard label="Total Effort" value={`${stats.totalEffort}h`} sub="estimated hours" />
          <StatCard label="Required Roles" value={stats.uniqueRoles} sub="unique roles assigned" />
          <StatCard label="Completion" value={`${stats.completion}%`} sub="tasks marked Done" />
        </div>

        {/* WBS table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-[11px] uppercase tracking-wide w-20">WBS #</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-[11px] uppercase tracking-wide">Task / Activity</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-[11px] uppercase tracking-wide w-24">Est. Hours</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-[11px] uppercase tracking-wide w-44">Required Role</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-600 text-[11px] uppercase tracking-wide">Notes</th>
                <th className="w-10 px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {phases.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-gray-400 text-[13px]">
                    No tasks yet. Click <span className="font-semibold text-teal-600">+ Add Task</span> to get started.
                  </td>
                </tr>
              )}

              {phases.map((phase) => {
                const phaseTasks = topLevelTasks.filter(
                  (t) => (t.phase || "General") === phase
                );
                const phTotal = phaseHours[phase] || 0;

                return [
                  /* Phase group header */
                  <tr key={`phase-${phase}`} className="bg-slate-50 border-b border-gray-100" style={{ borderLeft: "4px solid #14B8A6" }}>
                    <td colSpan={5} className="px-4 py-2">
                      <span className="font-semibold text-gray-700 text-[12px] uppercase tracking-wide">
                        {phase}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className="text-[11px] text-gray-500 font-medium">
                        {phTotal > 0 ? `${phTotal}h` : "—"}
                      </span>
                    </td>
                  </tr>,

                  /* Top-level tasks + subtasks */
                  ...phaseTasks.flatMap((task) => {
                    const subs = subtaskMap[task.id] || [];
                    return [
                      /* Parent task row */
                      <tr
                        key={task.id}
                        className={`border-b border-gray-100 hover:bg-gray-50 transition-colors group ${savingIds.has(task.id) ? "opacity-60" : ""}`}
                      >
                        <td className="px-4 py-2.5 text-gray-400 font-mono text-[11px]">
                          {getWbsNumber(phase, task.id)}
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <EditableText
                              value={task.name}
                              onSave={(v) => saveTaskField(task.id, { name: v })}
                              placeholder="Untitled task"
                              className="text-gray-800 font-medium"
                            />
                            <button
                              onClick={() => addSubtask(task)}
                              title="Add subtask"
                              className="ml-1 text-gray-300 hover:text-teal-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                              </svg>
                            </button>
                          </div>
                          {subs.length > 0 && (
                            <div className="text-[11px] text-gray-400 mt-0.5">
                              {subs.length} subtask{subs.length > 1 ? "s" : ""}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <HoursInput
                            value={task.estimatedHours}
                            onSave={(v) => saveTaskField(task.id, { estimatedHours: v })}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <RoleSelect
                            value={task.responsibleRole || ""}
                            onChange={(v) => saveTaskField(task.id, { responsibleRole: v })}
                          />
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 max-w-[180px]">
                          <EditableText
                            value={task.notes}
                            onSave={(v) => saveTaskField(task.id, { notes: v })}
                            placeholder="Add notes…"
                            multiline
                            className="text-[12px] text-gray-500"
                          />
                        </td>
                        <td className="px-2 py-2.5">
                          <button
                            onClick={() => deleteTask(task)}
                            title="Delete task"
                            className="text-gray-300 hover:text-red-400 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0a1 1 0 00-1-1h-4a1 1 0 00-1 1H5" />
                            </svg>
                          </button>
                        </td>
                      </tr>,

                      /* Subtask rows */
                      ...subs.map((sub) => (
                        <tr
                          key={sub.id}
                          className={`border-b border-gray-50 bg-gray-50/40 hover:bg-gray-50 transition-colors ${savingIds.has(sub.id) ? "opacity-60" : ""}`}
                        >
                          <td className="px-4 py-2 text-gray-400 font-mono text-[11px]">
                            {getWbsNumber(phase, sub.id)}
                          </td>
                          <td className="pl-10 pr-4 py-2">
                            <EditableText
                              value={sub.name}
                              onSave={(v) => saveTaskField(sub.id, { name: v })}
                              placeholder="Subtask name"
                              className="text-gray-700 text-[12px]"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <HoursInput
                              value={sub.estimatedHours}
                              onSave={(v) => saveTaskField(sub.id, { estimatedHours: v })}
                            />
                          </td>
                          <td className="px-4 py-2">
                            <RoleSelect
                              value={sub.responsibleRole || ""}
                              onChange={(v) => saveTaskField(sub.id, { responsibleRole: v })}
                            />
                          </td>
                          <td className="px-4 py-2 text-gray-400 max-w-[180px]">
                            <EditableText
                              value={sub.notes}
                              onSave={(v) => saveTaskField(sub.id, { notes: v })}
                              placeholder="Notes…"
                              multiline
                              className="text-[12px] text-gray-400"
                            />
                          </td>
                          <td className="px-2 py-2">
                            <button
                              onClick={() => deleteTask(sub)}
                              title="Delete subtask"
                              className="text-gray-300 hover:text-red-400 transition-colors"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m2 0a1 1 0 00-1-1h-4a1 1 0 00-1 1H5" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      )),
                    ];
                  }),

                  /* Add task row for this phase */
                  <tr key={`add-${phase}`} className="border-b border-gray-100">
                    <td colSpan={6} className="px-4 py-2">
                      <button
                        onClick={() => addTask(phase)}
                        className="inline-flex items-center gap-1.5 text-[12px] text-gray-400 hover:text-teal-600 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Add task to {phase}
                      </button>
                    </td>
                  </tr>,
                ];
              })}
            </tbody>
          </table>
        </div>

        {/* Bottom action bar */}
        <div className="flex items-center justify-between flex-wrap gap-3 pb-8">
          <div className="flex items-center gap-2">
            <button
              onClick={() => showToast("Import coming soon.")}
              className="inline-flex items-center gap-1.5 border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5m0 0l5-5m-5 5V4" />
              </svg>
              Import
            </button>
            <button
              onClick={() => showToast("Export coming soon.")}
              className="inline-flex items-center gap-1.5 border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 8l5-5m0 0l5 5m-5-5v12" />
              </svg>
              Export
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => showToast("Totals updated.")}
              className="inline-flex items-center gap-1.5 border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 text-[13px] font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Recalculate Totals
            </button>
            <button
              onClick={async () => {
                await checkPlanningStatus(project, topLevelTasks);
                const allFilled = topLevelTasks.every(
                  (t) => t.estimatedHours > 0 && t.responsibleRole
                );
                if (!allFilled) showToast("WBS saved. Some tasks still need hours or roles.");
                else showToast("WBS is up to date.");
              }}
              className="inline-flex items-center gap-1.5 bg-[#0F2240] hover:bg-[#162d52] text-white text-[13px] font-medium px-4 py-2 rounded-lg transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Save WBS
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
