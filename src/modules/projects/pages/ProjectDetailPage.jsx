import { useEffect, useState, Fragment } from "react";
import { useParams, Link } from "react-router-dom";
import {
  doc,
  onSnapshot,
  collection,
  query,
  orderBy,
  writeBatch,
  updateDoc,
  addDoc,
  deleteDoc,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { computeSchedule } from "../../../lib/scheduling";
import { computeRollups } from "../../../lib/completion";
import { useAuth } from "../../../context/AuthContext";
import { phaseColor, STATUS_PILL_STYLES } from "../../../lib/taskColors";
import { computeHealth, PROJECT_STATUS_GROUPS } from "../../../lib/health";

const STATUSES = ["Not Started", "In Progress", "Blocked", "Done"];

function ProgressBar({ pct }) {
  const rounded = Math.round(pct);
  return (
    <div className="flex items-center gap-1.5 w-24">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-teal rounded-full" style={{ width: `${rounded}%` }} />
      </div>
      <span className="text-[10px] text-gray-400 w-7 text-right">{rounded}%</span>
    </div>
  );
}

function derivedStatus(children) {
  if (children.length === 0) return "Not Started";
  if (children.some((c) => c.status === "Blocked")) return "Blocked";
  if (children.every((c) => c.status === "Done")) return "Done";
  if (children.some((c) => c.status === "Done" || c.status === "In Progress")) return "In Progress";
  return "Not Started";
}

function TaskRow({
  task, depth, members, childrenByParent, completionByTaskId,
  onCommit, onAddSubtask, onDelete, onMove, onIndent, onOutdent,
  expanded, onToggleExpand, isFirst, isLast, canIndent,
  selectedIds, onToggleSelect,
}) {
  const selected = selectedIds.has(task.id);
  const children = childrenByParent[task.id] || [];
  const hasChildren = children.length > 0;
  const rolledEstHours = hasChildren ? children.reduce((s, c) => s + (c.estimatedHours || 0), 0) : task.estimatedHours;
  const rolledActHours = hasChildren ? children.reduce((s, c) => s + (c.actualHours || 0), 0) : task.actualHours;
  const rolledStatus = hasChildren ? derivedStatus(children) : task.status;

  return (
    <>
      <tr className="border-t border-gray-100 hover:bg-slate-50/50 align-top">
        <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + depth * 20}px` }}>
          <div className="flex items-start gap-1.5">
            <input type="checkbox" checked={!!selected} onChange={() => onToggleSelect(task.id)} className="mt-1" />
            <div className="flex flex-col mt-0.5">
              <button onClick={() => !isFirst && onMove(task, -1)} disabled={isFirst} className="text-gray-300 hover:text-navy disabled:opacity-30 text-[9px] leading-none">▲</button>
              <button onClick={() => !isLast && onMove(task, 1)} disabled={isLast} className="text-gray-300 hover:text-navy disabled:opacity-30 text-[9px] leading-none">▼</button>
            </div>
            <div className="flex flex-col mt-0.5">
              {depth === 0 ? (
                <button onClick={() => canIndent && onIndent(task)} disabled={!canIndent} title="Make subtask of task above" className="text-gray-300 hover:text-navy disabled:opacity-30 text-[10px] leading-none">→</button>
              ) : (
                <button onClick={() => onOutdent(task)} title="Promote to top-level task" className="text-gray-300 hover:text-navy text-[10px] leading-none">←</button>
              )}
            </div>
            {hasChildren && (
              <button onClick={() => onToggleExpand(task.id)} className="text-gray-400 text-[10px] mt-0.5">
                {expanded ? "▾" : "▸"}
              </button>
            )}
            <div className="flex-1">
              <div className="text-navy">{task.name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                {hasChildren && <ProgressBar pct={completionByTaskId[task.id] || 0} />}
                {depth === 0 && (
                  <button onClick={() => onAddSubtask(task)} className="text-[10px] text-teal-700">
                    + subtask
                  </button>
                )}
                <button onClick={() => onDelete(task)} className="text-[10px] text-gray-300 hover:text-red-400">
                  delete
                </button>
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-1.5">
          {hasChildren ? (
            <span className="text-[11px] text-gray-400 italic">multiple</span>
          ) : (
            <select
              value={task.assigneeId || ""}
              onChange={(e) => onCommit(task, { assigneeId: e.target.value || null })}
              className="w-full border border-transparent hover:border-gray-200 rounded-md px-1.5 py-1 text-[11px] bg-transparent focus:bg-white focus:border-gray-300"
            >
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          )}
        </td>
        <td className="px-3 py-1.5">
          {hasChildren ? (
            <span className="text-[11px] text-gray-500">{rolledEstHours || "—"}<span className="text-gray-300"> (sum)</span></span>
          ) : (
            <input
              type="number" min="0" step="0.5"
              defaultValue={task.estimatedHours || ""}
              onBlur={(e) => onCommit(task, { estimatedHours: e.target.value ? Number(e.target.value) : null })}
              placeholder="—"
              className="w-16 border border-transparent hover:border-gray-200 rounded-md px-1.5 py-1 text-[11px] bg-transparent focus:bg-white focus:border-gray-300"
            />
          )}
        </td>
        <td className="px-3 py-1.5">
          {hasChildren ? (
            <span className="text-[11px] text-gray-500">{rolledActHours || "—"}<span className="text-gray-300"> (sum)</span></span>
          ) : (
            <input
              type="number" min="0" step="0.5"
              defaultValue={task.actualHours || ""}
              onBlur={(e) => onCommit(task, { actualHours: e.target.value ? Number(e.target.value) : null })}
              placeholder="—"
              className="w-16 border border-transparent hover:border-gray-200 rounded-md px-1.5 py-1 text-[11px] bg-transparent focus:bg-white focus:border-gray-300"
            />
          )}
        </td>
        <td className="px-3 py-1.5">
          {depth === 0 ? (
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={task.startDate || ""}
                onChange={(e) => onCommit(task, { startDate: e.target.value || null, startDateOverridden: true })}
                className="border border-transparent hover:border-gray-200 rounded-md px-1 py-1 text-[11px] bg-transparent focus:bg-white focus:border-gray-300 w-[112px]"
              />
              {task.startDateOverridden && (
                <button title="Reset to auto-calculated" onClick={() => onCommit(task, { startDateOverridden: false })} className="text-[10px] text-teal-700">
                  ↺
                </button>
              )}
            </div>
          ) : (
            <span className="text-gray-400 text-[11px]">—</span>
          )}
        </td>
        <td className="px-3 py-1.5 text-gray-500 text-[11px]">
          {depth === 0 ? task.dueDate || "—" : "—"}
        </td>
        <td className="px-3 py-1.5">
          <input
            type="date"
            defaultValue={task.actualCompletionDate || ""}
            onChange={(e) => onCommit(task, { actualCompletionDate: e.target.value || null })}
            className="border border-transparent hover:border-gray-200 rounded-md px-1.5 py-1 text-[11px] bg-transparent focus:bg-white focus:border-gray-300"
          />
        </td>
        <td className="px-3 py-1.5">
          {hasChildren ? (
            <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-medium ${STATUS_PILL_STYLES[rolledStatus] || STATUS_PILL_STYLES["Not Started"]}`}>
              {rolledStatus}
            </span>
          ) : (
            <select
              value={task.status}
              onChange={(e) => onCommit(task, { status: e.target.value })}
              className={`appearance-none cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-medium border-none focus:outline-none focus:ring-2 focus:ring-teal ${STATUS_PILL_STYLES[task.status] || STATUS_PILL_STYLES["Not Started"]}`}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}
        </td>
      </tr>
      {expanded &&
        children.map((c, idx) => (
          <TaskRow
            key={c.id}
            task={c}
            depth={depth + 1}
            members={members}
            childrenByParent={childrenByParent}
            completionByTaskId={completionByTaskId}
            onCommit={onCommit}
            onAddSubtask={onAddSubtask}
            onDelete={onDelete}
            onMove={onMove}
            onIndent={onIndent}
            onOutdent={onOutdent}
            expanded={true}
            onToggleExpand={onToggleExpand}
            isFirst={idx === 0}
            isLast={idx === children.length - 1}
            canIndent={false}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
          />
        ))}
    </>
  );
}

function AddTaskRow({ onCancel, onAdd }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onAdd(name.trim());
    setSaving(false);
    setName("");
  };
  return (
    <tr className="border-t border-gray-100 bg-slate-50">
      <td className="px-3 py-2" colSpan={8}>
        <div className="flex gap-2">
          <input autoFocus placeholder="New task name..." value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-[12px]" />
          <button onClick={save} disabled={saving} className="text-[11px] bg-navy text-white px-3 py-1 rounded-md">{saving ? "Adding..." : "Add"}</button>
          <button onClick={onCancel} className="text-[11px] text-gray-500 px-2">Cancel</button>
        </div>
      </td>
    </tr>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [addingTask, setAddingTask] = useState(false);
  const [collapsedPhases, setCollapsedPhases] = useState({});
  const [expandedTasks, setExpandedTasks] = useState({});
  const [rejectComment, setRejectComment] = useState("");
  const [showReject, setShowReject] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkMoveTarget, setBulkMoveTarget] = useState("");

  useEffect(() => {
    const unsubProject = onSnapshot(doc(db, "projects", id), (snap) => {
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    const unsubTasks = onSnapshot(
      query(collection(db, "projects", id, "tasks"), orderBy("order")),
      (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, parentTaskId: null, ...d.data() })))
    );
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => { unsubProject(); unsubTasks(); unsubUsers(); };
  }, [id]);

  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";
  const members = users.filter((u) => project?.memberIds?.includes(u.id));
  const isApprover = project?.approverId === user?.uid;
  const isOwner = project?.ownerId === user?.uid;

  const topLevelTasks = tasks.filter((t) => !t.parentTaskId);
  const { completionByTaskId, phaseCompletion, projectCompletion, childrenByParent } = computeRollups(tasks);

  const health = project ? computeHealth(project, projectCompletion) : null;

  const scheduledDueDates = topLevelTasks.filter((t) => t.dueDate).map((t) => t.dueDate);
  const proposedBaseline = scheduledDueDates.length ? scheduledDueDates.sort().at(-1) : null;

  const runTopLevelCascade = async (updatedTopLevel) => {
    const scheduled = computeSchedule(updatedTopLevel, project.startDate);
    const batch = writeBatch(db);
    scheduled.forEach((t) => {
      batch.update(doc(db, "projects", id, "tasks", t.id), {
        assigneeId: t.assigneeId ?? null,
        estimatedHours: t.estimatedHours ?? null,
        actualHours: t.actualHours ?? null,
        status: t.status,
        actualCompletionDate: t.actualCompletionDate ?? null,
        startDate: t.startDate,
        startDateOverridden: t.startDateOverridden ?? false,
        dueDate: t.dueDate,
      });
    });
    await batch.commit();
  };

  const commitTask = async (task, changes) => {
    if (!task.parentTaskId) {
      const updated = topLevelTasks.map((t) => (t.id === task.id ? { ...t, ...changes } : t));
      await runTopLevelCascade(updated);
      return;
    }
    // Subtask: write its own change, then roll hours/status up into the parent
    // and re-run the top-level cascade since the parent's derived hours may
    // have shifted the schedule.
    await updateDoc(doc(db, "projects", id, "tasks", task.id), changes);
    const parent = tasks.find((t) => t.id === task.parentTaskId);
    if (!parent) return;
    const siblings = tasks.filter((t) => t.parentTaskId === parent.id).map((t) => (t.id === task.id ? { ...t, ...changes } : t));
    const rolledEstHours = siblings.reduce((s, c) => s + (c.estimatedHours || 0), 0);
    const rolledActHours = siblings.reduce((s, c) => s + (c.actualHours || 0), 0);
    const rolledStatus = derivedStatus(siblings);
    const updatedTopLevel = topLevelTasks.map((t) =>
      t.id === parent.id ? { ...t, estimatedHours: rolledEstHours || null, actualHours: rolledActHours || null, status: rolledStatus } : t
    );
    await runTopLevelCascade(updatedTopLevel);
  };

  const addManualTask = async (name) => {
    await addDoc(collection(db, "projects", id, "tasks"), {
      parentTaskId: null, phase: "Additional Tasks", name, notes: "", responsibleRole: "",
      assigneeId: null, estimatedHours: null, actualHours: null, startDate: null, dueDate: null,
      startDateOverridden: false, actualCompletionDate: null, status: "Not Started", blockedBy: [],
      order: tasks.length + 1,
    });
    setAddingTask(false);
  };

  const addSubtask = async (parentTask) => {
    const name = window.prompt("Subtask name");
    if (!name || !name.trim()) return;
    const siblingCount = (childrenByParent[parentTask.id] || []).length;
    await addDoc(collection(db, "projects", id, "tasks"), {
      parentTaskId: parentTask.id, phase: parentTask.phase, name: name.trim(), notes: "", responsibleRole: "",
      assigneeId: null, estimatedHours: null, actualHours: null, startDate: null, dueDate: null,
      startDateOverridden: false, actualCompletionDate: null, status: "Not Started", blockedBy: [],
      order: siblingCount + 1,
    });
    setExpandedTasks((p) => ({ ...p, [parentTask.id]: true }));
  };

  const deleteTask = async (task) => {
    const children = childrenByParent[task.id] || [];
    if (!window.confirm(children.length ? `Delete "${task.name}" and its ${children.length} subtask(s)?` : `Delete "${task.name}"?`)) return;
    const batch = writeBatch(db);
    children.forEach((c) => batch.delete(doc(db, "projects", id, "tasks", c.id)));
    batch.delete(doc(db, "projects", id, "tasks", task.id));
    await batch.commit();
    if (!task.parentTaskId) {
      const remaining = topLevelTasks.filter((t) => t.id !== task.id);
      await runTopLevelCascade(remaining);
    }
  };

  const moveTask = async (task, direction) => {
    const siblings = task.parentTaskId
      ? tasks.filter((t) => t.parentTaskId === task.parentTaskId).sort((a, b) => a.order - b.order)
      : topLevelTasks.filter((t) => t.phase === task.phase).sort((a, b) => a.order - b.order);
    const idx = siblings.findIndex((t) => t.id === task.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= siblings.length) return;
    const a = siblings[idx];
    const b = siblings[swapIdx];
    const batch = writeBatch(db);
    batch.update(doc(db, "projects", id, "tasks", a.id), { order: b.order });
    batch.update(doc(db, "projects", id, "tasks", b.id), { order: a.order });
    await batch.commit();
    if (!task.parentTaskId) {
      const reordered = topLevelTasks.map((t) => {
        if (t.id === a.id) return { ...t, order: b.order };
        if (t.id === b.id) return { ...t, order: a.order };
        return t;
      }).sort((x, y) => x.order - y.order);
      await runTopLevelCascade(reordered);
    }
  };

  const [manualBaseline, setManualBaseline] = useState("");

  const toggleSelect = (taskId) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      return next;
    });
  };

  const indentTask = async (task) => {
    const siblings = topLevelTasks.filter((t) => t.phase === task.phase).sort((a, b) => a.order - b.order);
    const idx = siblings.findIndex((t) => t.id === task.id);
    if (idx <= 0) return;
    const newParent = siblings[idx - 1];
    const newParentChildren = childrenByParent[newParent.id] || [];
    await updateDoc(doc(db, "projects", id, "tasks", task.id), {
      parentTaskId: newParent.id,
      order: newParentChildren.length + 1,
    });
    const remainingTopLevel = topLevelTasks.filter((t) => t.id !== task.id);
    const rolledSiblings = [...newParentChildren, task];
    const updated = remainingTopLevel.map((t) =>
      t.id === newParent.id
        ? { ...t, estimatedHours: rolledSiblings.reduce((s, c) => s + (c.estimatedHours || 0), 0) || null,
            actualHours: rolledSiblings.reduce((s, c) => s + (c.actualHours || 0), 0) || null,
            status: derivedStatus(rolledSiblings) }
        : t
    );
    await runTopLevelCascade(updated);
  };

  const outdentTask = async (task) => {
    const parent = tasks.find((t) => t.id === task.parentTaskId);
    if (!parent) return;
    const phaseTopLevel = topLevelTasks.filter((t) => t.phase === parent.phase).sort((a, b) => a.order - b.order);
    const parentIdx = phaseTopLevel.findIndex((t) => t.id === parent.id);
    const nextSibling = phaseTopLevel[parentIdx + 1];
    const newOrder = nextSibling ? (parent.order + nextSibling.order) / 2 : parent.order + 0.5;
    await updateDoc(doc(db, "projects", id, "tasks", task.id), { parentTaskId: null, order: newOrder });
    const remainingChildren = (childrenByParent[parent.id] || []).filter((c) => c.id !== task.id);
    const updated = [
      ...topLevelTasks.map((t) =>
        t.id === parent.id
          ? { ...t, estimatedHours: remainingChildren.reduce((s, c) => s + (c.estimatedHours || 0), 0) || null,
              actualHours: remainingChildren.reduce((s, c) => s + (c.actualHours || 0), 0) || null,
              status: derivedStatus(remainingChildren) }
          : t
      ),
      { ...task, parentTaskId: null, order: newOrder },
    ].sort((a, b) => a.order - b.order);
    await runTopLevelCascade(updated);
  };

  const bulkDeleteSelected = async () => {
    if (!selectedIds.size) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected task(s)? Subtasks under any selected parent will also be deleted.`)) return;
    const batch = writeBatch(db);
    const idsToDelete = new Set(selectedIds);
    tasks.forEach((t) => {
      if (t.parentTaskId && idsToDelete.has(t.parentTaskId)) idsToDelete.add(t.id);
    });
    idsToDelete.forEach((tid) => batch.delete(doc(db, "projects", id, "tasks", tid)));
    await batch.commit();
    const remaining = topLevelTasks.filter((t) => !idsToDelete.has(t.id));
    await runTopLevelCascade(remaining);
    setSelectedIds(new Set());
  };

  const bulkMoveToPhase = async () => {
    if (!selectedIds.size || !bulkMoveTarget) return;
    const batch = writeBatch(db);
    selectedIds.forEach((tid) => {
      batch.update(doc(db, "projects", id, "tasks", tid), { phase: bulkMoveTarget, parentTaskId: null });
    });
    await batch.commit();
    setSelectedIds(new Set());
    setBulkMoveTarget("");
  };

  const submitBaseline = async () => {
    const dateToSubmit = proposedBaseline || manualBaseline;
    if (!dateToSubmit) return;
    await updateDoc(doc(db, "projects", id), { baselineStatus: "Pending Approval", proposedBaselineEndDate: dateToSubmit });
  };
  const approveBaseline = async () => {
    // Approving the baseline is what graduates a project out of "Scoping" --
    // per Sandy's direction, status stays Scoping by default until a baseline
    // is locked, then normal status/health tracking (Planning onward) applies.
    await updateDoc(doc(db, "projects", id), {
      baselineStatus: "Locked",
      baselineEndDate: project.proposedBaselineEndDate,
      baselineRejectionComment: null,
      status: project.status === "Scoping" ? "Planning" : project.status,
    });
  };
  const rejectBaseline = async () => {
    await updateDoc(doc(db, "projects", id), { baselineStatus: "Rejected", baselineRejectionComment: rejectComment });
    setShowReject(false);
    setRejectComment("");
  };

  // Post-lock guardrail: if the live computed schedule now runs past the
  // locked (or last-approved-revised) baseline, flag it -- but never block
  // adding/editing tasks. Resolving the slip requires a Deadline Change
  // Request to the Approver; work continues regardless while it's pending.
  const effectiveLockedEnd = project.approvedRevisedEndDate || project.baselineEndDate;
  const isSlipping =
    project.baselineStatus === "Locked" &&
    proposedBaseline &&
    effectiveLockedEnd &&
    proposedBaseline > effectiveLockedEnd &&
    project.revisedDeadlineStatus !== "Pending Approval";

  const [showRevisedReject, setShowRevisedReject] = useState(false);
  const [revisedRejectComment, setRevisedRejectComment] = useState("");

  const submitDeadlineChangeRequest = async () => {
    await updateDoc(doc(db, "projects", id), {
      revisedDeadlineStatus: "Pending Approval",
      proposedRevisedEndDate: proposedBaseline,
    });
  };
  const approveDeadlineChange = async () => {
    await updateDoc(doc(db, "projects", id), {
      revisedDeadlineStatus: null,
      approvedRevisedEndDate: project.proposedRevisedEndDate,
    });
  };
  const rejectDeadlineChange = async () => {
    await updateDoc(doc(db, "projects", id), {
      revisedDeadlineStatus: "Rejected",
      revisedDeadlineRejectionComment: revisedRejectComment,
    });
    setShowRevisedReject(false);
    setRevisedRejectComment("");
  };

  if (!project) return <p className="text-[13px] text-gray-400">Loading project...</p>;

  const phaseOrder = [];
  topLevelTasks.forEach((t) => { if (!phaseOrder.includes(t.phase)) phaseOrder.push(t.phase); });

  return (
    <div>
      <Link to="/projects" className="text-[11px] text-navy underline">← Back to Projects</Link>
      <div className="flex items-start justify-between mt-2 mb-0.5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold font-heading text-navy">{project.name}</h2>
            <span className="text-[11px] text-gray-400 font-mono">{project.projectCode}</span>
            <span className="bg-violet-50 border-l-2 border-violet-300 text-violet-700 px-1.5 py-0.5 rounded text-[11px] font-medium">{project.priority}</span>
            <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${health.style}`}>{health.label}</span>
          </div>
          <p className="text-xs text-gray-500">{project.description}</p>
        </div>
        <div className="flex items-center gap-3">
          {project.folderUrl && (
            <a href={project.folderUrl} target="_blank" rel="noreferrer" className="text-[11px] text-teal-700 underline whitespace-nowrap">Project Folder ↗</a>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4 text-[13px]">
        <div className="bg-teal/5 rounded-lg shadow-sm border-2 border-teal/30 p-3">
          <div className="text-[10px] text-teal-700 uppercase tracking-wide font-semibold">Completion</div>
          <div className="text-2xl font-bold text-navy mt-1">{Math.round(projectCompletion)}%</div>
          <div className="h-1.5 bg-white rounded-full overflow-hidden mt-1.5">
            <div className="h-full bg-teal rounded-full" style={{ width: `${Math.round(projectCompletion)}%` }} />
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 border-l-2 border-l-slate-300 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Status</div>
          <select
            value={project.status || "Planning"}
            onChange={(e) => updateDoc(doc(db, "projects", id), { status: e.target.value })}
            className="font-medium text-navy mt-1 bg-transparent border-none p-0 text-[13px] focus:outline-none"
          >
            {Object.entries(PROJECT_STATUS_GROUPS).map(([group, options]) => (
              <optgroup key={group} label={group}>
                {options.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 border-l-2 border-l-blue-300 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Owner</div>
          <div className="font-medium text-navy mt-1">{nameFor(project.ownerId)}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 border-l-2 border-l-purple-300 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Approver</div>
          <div className="font-medium text-navy mt-1">{nameFor(project.approverId)}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 border-l-2 border-l-emerald-300 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Work Type</div>
          <div className="font-medium text-navy mt-1">{project.workTypeName}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 border-l-2 border-l-amber-300 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Delivery Format</div>
          <div className="font-medium text-navy mt-1">{project.deliveryFormat || "—"}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 border-l-2 border-l-pink-300 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Training Type</div>
          <div className="font-medium text-navy mt-1">{project.trainingType || "—"}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 border-l-2 border-l-cyan-300 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Development Type</div>
          <div className="font-medium text-navy mt-1">{project.developmentType || "—"}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 border-l-2 border-l-orange-300 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Source</div>
          <div className="font-medium text-navy mt-1">
            {project.source}
            {project.source === "Intake Request" && (
              <div className="text-[11px] text-gray-400 font-normal">{project.requestorName} — {project.requestorDepartment}</div>
            )}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 border-l-2 border-l-teal-300 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Actual Completion</div>
          <div className="font-medium text-navy mt-1">{project.actualCompletionDate || "—"}</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1">Baseline Deadline — {project.baselineStatus}</div>
            {project.baselineStatus === "Locked" ? (
              <div className="text-[13px] font-semibold text-navy">{project.baselineEndDate} (locked)</div>
            ) : project.baselineStatus === "Pending Approval" ? (
              <div className="text-[13px] text-amber-700">Awaiting approval — proposed date {project.proposedBaselineEndDate}</div>
            ) : project.baselineStatus === "Rejected" ? (
              <div className="text-[13px] text-red-600">Rejected: {project.baselineRejectionComment}</div>
            ) : proposedBaseline ? (
              <div className="text-[13px] text-gray-500">Ready to submit — computed end date {proposedBaseline}</div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-gray-500">No tasks have hours yet — set a target manually, or add hours below to auto-compute one:</span>
                <input type="date" value={manualBaseline} onChange={(e) => setManualBaseline(e.target.value)} className="border border-gray-300 rounded-md px-2 py-1 text-[11px]" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isOwner && (project.baselineStatus === "Not Submitted" || project.baselineStatus === "Rejected") && (
              <button onClick={submitBaseline} disabled={!proposedBaseline && !manualBaseline} className="text-[11px] bg-navy text-white px-3 py-1.5 rounded-md disabled:opacity-40">
                Submit Baseline for Approval
              </button>
            )}
            {isApprover && project.baselineStatus === "Pending Approval" && !showReject && (
              <>
                <button onClick={approveBaseline} className="text-[11px] bg-teal text-navy font-medium px-3 py-1.5 rounded-md">Approve</button>
                <button onClick={() => setShowReject(true)} className="text-[11px] border border-gray-300 px-3 py-1.5 rounded-md text-gray-600">Reject</button>
              </>
            )}
          </div>
        </div>
        {showReject && (
          <div className="mt-3 flex gap-2">
            <input placeholder="Reason for rejection" value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-[11px]" />
            <button onClick={rejectBaseline} className="text-[11px] bg-red-500 text-white px-3 py-1.5 rounded-md">Confirm Reject</button>
          </div>
        )}
      </div>

      {isSlipping && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 mb-4">
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-amber-800">
              Current task hours now compute an end date of <strong>{proposedBaseline}</strong>, past the locked baseline of{" "}
              <strong>{effectiveLockedEnd}</strong>. Work isn't blocked — but the deadline needs a formal revision to stay accurate.
            </div>
            {isOwner && (
              <button onClick={submitDeadlineChangeRequest} className="text-[11px] bg-navy text-white px-3 py-1.5 rounded-md whitespace-nowrap ml-3">
                Request Deadline Change
              </button>
            )}
          </div>
        </div>
      )}

      {project.revisedDeadlineStatus === "Pending Approval" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 mb-4">
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-amber-800">
              Deadline change requested: revise to <strong>{project.proposedRevisedEndDate}</strong>
            </div>
            {isApprover && !showRevisedReject && (
              <div className="flex gap-2">
                <button onClick={approveDeadlineChange} className="text-[11px] bg-teal text-navy font-medium px-3 py-1.5 rounded-md">Approve</button>
                <button onClick={() => setShowRevisedReject(true)} className="text-[11px] border border-gray-300 px-3 py-1.5 rounded-md text-gray-600">Reject</button>
              </div>
            )}
          </div>
          {showRevisedReject && (
            <div className="mt-3 flex gap-2">
              <input placeholder="Reason for rejection" value={revisedRejectComment} onChange={(e) => setRevisedRejectComment(e.target.value)} className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-[11px]" />
              <button onClick={rejectDeadlineChange} className="text-[11px] bg-red-500 text-white px-3 py-1.5 rounded-md">Confirm Reject</button>
            </div>
          )}
        </div>
      )}
      {project.revisedDeadlineStatus === "Rejected" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 mb-4 text-[13px] text-red-700">
          Deadline change rejected: {project.revisedDeadlineRejectionComment}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-navy font-heading">Task List — {project.workTypeName}</h3>
          <button onClick={() => setAddingTask(true)} className="text-[11px] text-navy underline">+ Add Task</button>
        </div>
        {selectedIds.size > 0 && (
          <div className="px-3 py-2 bg-slate-50 border-b border-gray-100 flex items-center gap-3 text-[11px]">
            <span className="text-gray-500">{selectedIds.size} selected</span>
            <button onClick={bulkDeleteSelected} className="text-red-500 hover:underline">Delete selected</button>
            <div className="flex items-center gap-1.5">
              <select value={bulkMoveTarget} onChange={(e) => setBulkMoveTarget(e.target.value)} className="border border-gray-300 rounded-md px-1.5 py-1 text-[11px]">
                <option value="">Move to phase...</option>
                {phaseOrder.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
              <button onClick={bulkMoveToPhase} disabled={!bulkMoveTarget} className="text-navy underline disabled:opacity-30 disabled:no-underline">Move</button>
            </div>
            <button onClick={() => setSelectedIds(new Set())} className="text-gray-400 ml-auto">Clear</button>
          </div>
        )}
        <table className="w-full text-[12px]">
          <thead className="bg-slate-50 text-left text-[10px] text-gray-400 uppercase tracking-wide font-medium">
            <tr>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2">Assignee</th>
              <th className="px-3 py-2">Est. Hrs</th>
              <th className="px-3 py-2">Actual Hrs</th>
              <th className="px-3 py-2">Start Date</th>
              <th className="px-3 py-2">End Date</th>
              <th className="px-3 py-2">Actual Completion</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {addingTask && <AddTaskRow onCancel={() => setAddingTask(false)} onAdd={addManualTask} />}
            {phaseOrder.map((phase, phaseIdx) => {
              const phaseTasks = topLevelTasks.filter((t) => t.phase === phase).sort((a, b) => a.order - b.order);
              const collapsed = collapsedPhases[phase];
              return (
                <Fragment key={phase}>
                  <tr onClick={() => setCollapsedPhases((p) => ({ ...p, [phase]: !p[phase] }))} className={`cursor-pointer border-l-2 ${phaseColor(phaseIdx)}`}>
                    <td colSpan={8} className="px-3 py-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase">
                          {collapsed ? "▸" : "▾"} {phase}{" "}
                          <span className="font-normal normal-case text-[10px] opacity-70">({phaseTasks.length} task{phaseTasks.length !== 1 ? "s" : ""})</span>
                        </span>
                        <ProgressBar pct={phaseCompletion[phase] || 0} />
                      </div>
                    </td>
                  </tr>
                  {!collapsed &&
                    phaseTasks.map((t, idx) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        depth={0}
                        members={members}
                        childrenByParent={childrenByParent}
                        completionByTaskId={completionByTaskId}
                        onCommit={commitTask}
                        onAddSubtask={addSubtask}
                        onDelete={deleteTask}
                        onMove={moveTask}
                        onIndent={indentTask}
                        onOutdent={outdentTask}
                        expanded={!!expandedTasks[t.id]}
                        onToggleExpand={(taskId) => setExpandedTasks((p) => ({ ...p, [taskId]: !p[taskId] }))}
                        isFirst={idx === 0}
                        isLast={idx === phaseTasks.length - 1}
                        canIndent={idx > 0}
                        selectedIds={selectedIds}
                        onToggleSelect={toggleSelect}
                      />
                    ))}
                </Fragment>
              );
            })}
            {tasks.length === 0 && !addingTask && (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">No tasks yet. Click "+ Add Task" to start building the list.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
