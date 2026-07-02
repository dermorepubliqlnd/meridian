import { useEffect, useState, Fragment } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
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
  getDocs,
  arrayUnion,
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

function projectStatusStyle(status) {
  if (["Scoping", "Backlog", "Queued"].includes(status))
    return "bg-gray-100 text-gray-600 border border-gray-200";
  if (["Done", "Canceled", "Merged"].includes(status))
    return "bg-emerald-100 text-emerald-700 border border-emerald-200";
  return "bg-blue-100 text-blue-700 border border-blue-200";
}

function TaskRow({
  task, depth, members, childrenByParent, completionByTaskId,
  onCommit, onAddSubtask, onDelete, onIndent, onOutdent,
  expanded, onToggleExpand, canIndent,
  selectedIds, onToggleSelect,
  onDragStart, onDragOver, onDrop, onDragEnd,
  isDraggedOver, isDragging,
  onContextMenuRow,
}) {
  const selected = selectedIds.has(task.id);
  const children = childrenByParent[task.id] || [];
  const hasChildren = children.length > 0;
  const rolledEstHours = hasChildren ? children.reduce((s, c) => s + (c.estimatedHours || 0), 0) : task.estimatedHours;
  const rolledActHours = hasChildren ? children.reduce((s, c) => s + (c.actualHours || 0), 0) : task.actualHours;
  const rolledStatus = hasChildren ? derivedStatus(children) : task.status;
  const isDraggable = depth === 0;

  return (
    <>
      <tr
        className={`align-top border-t ${isDraggedOver ? "border-t-2 border-teal bg-teal-50/30" : "border-gray-100"} hover:bg-slate-50/50 ${isDragging ? "opacity-40" : ""}`}
        draggable={isDraggable}
        onDragStart={isDraggable ? () => onDragStart(task) : undefined}
        onDragOver={isDraggable ? (e) => { e.preventDefault(); onDragOver(task); } : undefined}
        onDrop={isDraggable ? (e) => { e.preventDefault(); onDrop(task); } : undefined}
        onDragEnd={isDraggable ? onDragEnd : undefined}
        onContextMenu={(e) => { e.preventDefault(); if (onContextMenuRow) onContextMenuRow(e, task, canIndent, depth > 0); }}
      >
        <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + depth * 20}px` }}>
          <div className="flex items-start gap-1.5">
            {/* Drag handle — top-level tasks only */}
            {depth === 0 && (
              <span
                className="text-gray-300 cursor-grab active:cursor-grabbing mt-1 text-[13px] select-none hover:text-gray-500 flex-shrink-0"
                title="Drag to reorder"
              >⠿</span>
            )}
            <input
              type="checkbox"
              checked={!!selected}
              onChange={() => onToggleSelect(task.id)}
              className="mt-1 flex-shrink-0"
            />
            {hasChildren && (
              <button onClick={() => onToggleExpand(task.id)} className="text-gray-400 text-[10px] mt-0.5 flex-shrink-0">
                {expanded ? "▾" : "▸"}
              </button>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-navy">{task.name}</div>
              {/* Indent / Outdent — only shown when row is selected */}
              {selected && (
                <div className="flex items-center gap-1.5 mt-1">
                  {depth === 0 && canIndent && (
                    <button
                      onClick={() => onIndent(task)}
                      title="Make subtask of task above"
                      className="text-[10px] text-teal-700 border border-teal-200 bg-teal-50 rounded px-1.5 py-0.5 hover:bg-teal-100"
                    >→ Indent</button>
                  )}
                  {depth > 0 && (
                    <button
                      onClick={() => onOutdent(task)}
                      title="Promote to top-level task"
                      className="text-[10px] text-teal-700 border border-teal-200 bg-teal-50 rounded px-1.5 py-0.5 hover:bg-teal-100"
                    >← Outdent</button>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                {hasChildren && <ProgressBar pct={completionByTaskId[task.id] || 0} />}
                {depth === 0 && (
                  <button onClick={() => onAddSubtask(task)} className="text-[10px] text-teal-700">
                    + subtask
                  </button>
                )}
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
        children.map((c) => (
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
            onIndent={onIndent}
            onOutdent={onOutdent}
            expanded={true}
            onToggleExpand={onToggleExpand}
            canIndent={false}
            selectedIds={selectedIds}
            onToggleSelect={onToggleSelect}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            onDragEnd={onDragEnd}
            isDraggedOver={false}
            isDragging={false}
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


// ── Team Member Manager ───────────────────────────────────────────────────────
function TeamMemberManager({ projectId, memberIds, ownerId, approverId, allUsers }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const eligible = allUsers.filter(
    (u) => u.id !== ownerId && u.id !== approverId && !memberIds.includes(u.id)
  );

  const addMember = async (uid) => {
    setSaving(true);
    await updateDoc(doc(db, "projects", projectId), { memberIds: arrayUnion(uid) });
    setSaving(false);
    setOpen(false);
  };

  if (eligible.length === 0 && !open) return (
    <span className="text-[11px] text-gray-400 italic">All users already added.</span>
  );

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11px] text-teal-700 border border-teal-200 bg-teal-50 rounded-md px-2.5 py-1 hover:bg-teal-100"
      >
        + Add member
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-8 z-40 bg-white shadow-xl border border-gray-200 rounded-lg py-1 w-52 max-h-64 overflow-y-auto">
            <div className="px-3 py-1.5 text-[10px] text-gray-400 uppercase tracking-wide border-b border-gray-100">Add team member</div>
            {eligible.length === 0 && (
              <p className="px-3 py-2 text-[12px] text-gray-400 italic">No more users to add.</p>
            )}
            {eligible.map((u) => (
              <button
                key={u.id}
                disabled={saving}
                onClick={() => addMember(u.id)}
                className="w-full text-left px-3 py-2 text-[12px] text-gray-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <div className="w-5 h-5 rounded-full bg-navy/20 text-navy text-[9px] font-bold flex items-center justify-center shrink-0">
                  {u.name?.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <div className="truncate">{u.name}</div>
                  {u.jobTitle && <div className="text-[10px] text-gray-400 truncate">{u.jobTitle}</div>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const { user, profile } = useAuth();
  const navigate = useNavigate();
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
  const [manualBaseline, setManualBaseline] = useState("");
  const [showRevisedReject, setShowRevisedReject] = useState(false);
  const [revisedRejectComment, setRevisedRejectComment] = useState("");
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverTaskId, setDragOverTaskId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [showDeleteProjectConfirm, setShowDeleteProjectConfirm] = useState(false);

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

  if (!project) return <p className="text-[13px] text-gray-400 p-4">Loading project...</p>;

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

  const deleteProject = async () => {
    // Delete all tasks in subcollection, then the project doc
    const taskSnap = await getDocs(collection(db, "projects", id, "tasks"));
    const batch = writeBatch(db);
    taskSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "projects", id));
    await batch.commit();
    navigate("/projects");
  };

  // Drag-and-drop reorder within a phase: remove dragged task, insert before
  // drop target, then redistribute the existing order values to the new sequence.
  const reorderTaskInPhase = async (draggedTask, targetTask) => {
    if (draggedTask.id === targetTask.id || draggedTask.phase !== targetTask.phase) return;
    const phase = draggedTask.phase;
    const phaseTasks = topLevelTasks.filter((t) => t.phase === phase).sort((a, b) => a.order - b.order);
    const existingOrders = phaseTasks.map((t) => t.order);

    const withoutDragged = phaseTasks.filter((t) => t.id !== draggedTask.id);
    const targetIdx = withoutDragged.findIndex((t) => t.id === targetTask.id);
    withoutDragged.splice(targetIdx, 0, draggedTask);

    const batch = writeBatch(db);
    withoutDragged.forEach((t, i) => {
      batch.update(doc(db, "projects", id, "tasks", t.id), { order: existingOrders[i] });
    });
    await batch.commit();

    const orderMap = {};
    withoutDragged.forEach((t, i) => { orderMap[t.id] = existingOrders[i]; });
    const allUpdated = topLevelTasks
      .map((t) => (orderMap[t.id] !== undefined ? { ...t, order: orderMap[t.id] } : t))
      .sort((a, b) => a.order - b.order);
    await runTopLevelCascade(allUpdated);
  };

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

  const effectiveLockedEnd = project.approvedRevisedEndDate || project.baselineEndDate;
  const isSlipping =
    project.baselineStatus === "Locked" &&
    proposedBaseline &&
    effectiveLockedEnd &&
    proposedBaseline > effectiveLockedEnd &&
    project.revisedDeadlineStatus !== "Pending Approval";

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

  const phaseOrder = [];
  topLevelTasks.forEach((t) => { if (!phaseOrder.includes(t.phase)) phaseOrder.push(t.phase); });

  return (
    <div>
      <Link to="/projects" className="text-[11px] text-navy underline">← Back to Projects</Link>

      {/* ── Header ── */}
      <div className="flex items-start justify-between mt-2 mb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold font-heading text-navy">{project.name}</h2>
            <span className="text-[11px] text-gray-400 font-mono">{project.projectCode}</span>
            <span className="bg-violet-50 border-l-2 border-violet-300 text-violet-700 px-1.5 py-0.5 rounded text-[11px] font-medium">{project.priority}</span>
            {/* Status — pill dropdown */}
            <select
              value={project.status || "Scoping"}
              onChange={(e) => updateDoc(doc(db, "projects", id), { status: e.target.value })}
              className={`appearance-none cursor-pointer rounded-full px-2.5 py-0.5 text-[11px] font-medium focus:outline-none focus:ring-2 focus:ring-teal ${projectStatusStyle(project.status || "Scoping")}`}
            >
              {Object.entries(PROJECT_STATUS_GROUPS).map(([group, options]) => (
                <optgroup key={group} label={group}>
                  {options.map((s) => <option key={s} value={s}>{s}</option>)}
                </optgroup>
              ))}
            </select>
            <span className="text-[10px] text-gray-400 mr-0.5">Health:</span>
            <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${health.style}`}>{health.label}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{project.description}</p>
        </div>
        <div className="flex items-center gap-3">
          {profile?.role === "Admin" && (
            <button onClick={() => setShowDeleteProjectConfirm(true)} className="text-[11px] text-red-400 hover:text-red-600 border border-red-200 rounded-md px-2.5 py-1 hover:border-red-400 transition">
              Delete project
            </button>
          )}
          {project.folderUrl && (
            <a href={project.folderUrl} target="_blank" rel="noreferrer" className="text-[11px] text-teal-700 underline whitespace-nowrap">Project Folder ↗</a>
          )}
        </div>
      </div>

      {/* ── Project info — form fields ── */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 px-5 py-4 mb-4">
        <div className="grid grid-cols-3 gap-x-10 gap-y-4 text-[12px]">
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">Owner</div>
            <div className="text-navy font-medium">{nameFor(project.ownerId)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">Approver</div>
            <div className="text-navy font-medium">{nameFor(project.approverId)}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">Work Type</div>
            <div className="text-navy font-medium">{project.workTypeName || "—"}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">Delivery Format</div>
            <div className="text-navy font-medium">{project.deliveryFormat || "—"}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">Training Type</div>
            <div className="text-navy font-medium">{project.trainingType || "—"}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">Development Type</div>
            <div className="text-navy font-medium">{project.developmentType || "—"}</div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">Source</div>
            <div className="text-navy font-medium">
              {project.source || "—"}
              {project.source === "Intake Request" && (
                <div className="text-[11px] text-gray-400 font-normal">{project.requestorName} — {project.requestorDepartment}</div>
              )}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">Est. Hours (total)</div>
            <div className="text-navy font-medium">
              {(() => {
                const tot = topLevelTasks.reduce((s, t) => s + (childrenByParent[t.id]?.length ? childrenByParent[t.id].reduce((cs, c) => cs + (c.estimatedHours || 0), 0) : (t.estimatedHours || 0)), 0);
                return tot ? `${tot} hrs` : "—";
              })()}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-0.5">Actual Hours (total)</div>
            <div className="text-navy font-medium">
              {(() => {
                const tot = topLevelTasks.reduce((s, t) => s + (childrenByParent[t.id]?.length ? childrenByParent[t.id].reduce((cs, c) => cs + (c.actualHours || 0), 0) : (t.actualHours || 0)), 0);
                return tot ? `${tot} hrs` : "—";
              })()}
            </div>
          </div>
          <div className="col-span-3">
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1">Completion</div>
            <div className="flex items-center gap-3">
              <span className="text-navy font-bold text-lg">{Math.round(projectCompletion)}%</span>
              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-teal rounded-full" style={{ width: `${Math.round(projectCompletion)}%` }} />
              </div>
              <span className="text-[11px] text-gray-400 whitespace-nowrap">{project.actualCompletionDate || "No completion date"}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Team Members ── */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide">Team Members</h3>
          {(isOwner || profile?.role === "Admin") && (
            <TeamMemberManager
              projectId={id}
              memberIds={project.memberIds || []}
              ownerId={project.ownerId}
              approverId={project.approverId}
              allUsers={users}
            />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {members.length === 0 && <span className="text-[12px] text-gray-400 italic">No additional team members.</span>}
          {members.map((m) => {
            const initials = m.name?.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";
            const isCore = m.id === project.ownerId || m.id === project.approverId;
            return (
              <div key={m.id} className="flex items-center gap-1.5 bg-slate-50 border border-gray-200 rounded-full px-2.5 py-1">
                <div className="w-5 h-5 rounded-full bg-navy text-white text-[9px] font-bold flex items-center justify-center">{initials}</div>
                <span className="text-[12px] text-gray-700">{m.name}</span>
                {isCore && <span className="text-[9px] text-gray-400">{m.id === project.ownerId ? "Owner" : "Approver"}</span>}
                {!isCore && (isOwner || profile?.role === "Admin") && (
                  <button
                    onClick={async () => {
                      const updated = (project.memberIds || []).filter((uid) => uid !== m.id);
                      await updateDoc(doc(db, "projects", id), { memberIds: updated });
                    }}
                    className="text-gray-300 hover:text-red-400 text-[10px] ml-0.5"
                  >✕</button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Baseline deadline ── */}
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

      {/* ── Task list ── */}
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
                    <td colSpan={2} className="px-3 py-1.5">
                      <span className="text-[13px] font-bold uppercase">
                        {collapsed ? "▸" : "▾"} {phase}{" "}
                        <span className="font-normal normal-case text-[11px] opacity-70">({phaseTasks.length} task{phaseTasks.length !== 1 ? "s" : ""})</span>
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-[12px] font-semibold text-gray-600">
                      {(() => { const sum = phaseTasks.reduce((s, t) => s + (childrenByParent[t.id]?.length ? childrenByParent[t.id].reduce((cs, c) => cs + (c.estimatedHours || 0), 0) : (t.estimatedHours || 0)), 0); return sum ? <span>{sum}<span className="text-[10px] text-gray-400 font-normal"> hrs</span></span> : "—"; })()}
                    </td>
                    <td className="px-3 py-1.5 text-[12px] font-semibold text-gray-600">
                      {(() => { const sum = phaseTasks.reduce((s, t) => s + (childrenByParent[t.id]?.length ? childrenByParent[t.id].reduce((cs, c) => cs + (c.actualHours || 0), 0) : (t.actualHours || 0)), 0); return sum ? <span>{sum}<span className="text-[10px] text-gray-400 font-normal"> hrs</span></span> : "—"; })()}
                    </td>
                    <td colSpan={4} className="px-3 py-1.5">
                      <div className="flex justify-end">
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
                        onIndent={indentTask}
                        onOutdent={outdentTask}
                        expanded={!!expandedTasks[t.id]}
                        onToggleExpand={(taskId) => setExpandedTasks((p) => ({ ...p, [taskId]: !p[taskId] }))}
                        canIndent={idx > 0}
                        selectedIds={selectedIds}
                        onToggleSelect={toggleSelect}
                        onDragStart={(task) => setDraggedTaskId(task.id)}
                        onDragOver={(task) => setDragOverTaskId(task.id)}
                        onDrop={(targetTask) => {
                          const dragged = tasks.find((x) => x.id === draggedTaskId);
                          if (dragged) reorderTaskInPhase(dragged, targetTask);
                          setDraggedTaskId(null);
                          setDragOverTaskId(null);
                        }}
                        onDragEnd={() => { setDraggedTaskId(null); setDragOverTaskId(null); }}
                        isDraggedOver={dragOverTaskId === t.id && draggedTaskId !== t.id}
                        isDragging={draggedTaskId === t.id}
                        onContextMenuRow={(e, task, canInd, canOut) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, task, canIndent: canInd, canOutdent: canOut });
                        }}
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

      {/* ── Right-click context menu ── */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 py-1 min-w-[140px]"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseLeave={() => setContextMenu(null)}
        >
          {contextMenu.canIndent && (
            <button className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 hover:bg-slate-50"
              onClick={() => { indentTask(contextMenu.task); setContextMenu(null); }}>
              → Indent
            </button>
          )}
          {contextMenu.canOutdent && (
            <button className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 hover:bg-slate-50"
              onClick={() => { outdentTask(contextMenu.task); setContextMenu(null); }}>
              ← Outdent
            </button>
          )}
          <button className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 hover:bg-slate-50"
            onClick={() => { addSubtask(contextMenu.task); setContextMenu(null); }}>
            + Add subtask
          </button>
          <div className="border-t border-gray-100 my-0.5" />
          <button className="w-full text-left px-3 py-1.5 text-[12px] text-red-500 hover:bg-red-50"
            onClick={() => { deleteTask(contextMenu.task); setContextMenu(null); }}>
            Delete task
          </button>
        </div>
      )}
      {contextMenu && <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />}

      {/* ── Delete project confirm ── */}
      {showDeleteProjectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-[15px] font-bold text-navy font-heading mb-2">Delete project?</h3>
            <p className="text-[13px] text-gray-600 mb-4">
              This will permanently delete <strong>"{project.name}"</strong> and all its tasks. This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowDeleteProjectConfirm(false)} className="px-4 py-2 text-[12px] border border-gray-300 rounded-md text-gray-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={deleteProject} className="px-4 py-2 text-[12px] bg-red-600 text-white rounded-md hover:bg-red-700">
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}