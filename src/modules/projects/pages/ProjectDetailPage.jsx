import { useEffect, useState, Fragment } from "react";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
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
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { computeSchedule } from "../../../lib/scheduling";
import { computeRollups } from "../../../lib/completion";
import { useAuth } from "../../../context/AuthContext";
import { phaseColor, STATUS_PILL_STYLES } from "../../../lib/taskColors";
import { computeHealth, PROJECT_STATUSES, PROJECT_PHASES, STATUS_STYLES, PHASE_STYLES, migrateLegacyStatus } from "../../../lib/health";
import { useSettingsList } from "../../../lib/useSettingsList";

const STATUSES = ["Not Started", "In Progress", "Blocked", "Ready for Completion", "Done"];

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
  if (children.every((c) => c.status === "Done" || c.status === "Ready for Completion")) return "Ready for Completion";
  if (children.some((c) => c.status === "Done" || c.status === "In Progress" || c.status === "Ready for Completion")) return "In Progress";
  return "Not Started";
}

// projectStatusStyle removed — using STATUS_STYLES from health.js

function TaskRow({
  task, depth, members, childrenByParent, completionByTaskId,
  onCommit, onAddSubtask, onDelete, onIndent, onOutdent,
  expanded, onToggleExpand, canIndent,
  selectedIds, onToggleSelect,
  onDragStart, onDragOver, onDrop, onDragEnd,
  isDraggedOver, isDragging,
  onContextMenuRow,
  addingSubtaskFor, onCommitSubtask,
  today, expandedNotes, onToggleNote, onSaveNote, onOpenNote,
  onRequestDCR,
}) {
  const selected = selectedIds.has(task.id);
  const children = childrenByParent[task.id] || [];
  const hasChildren = children.length > 0;
  const rolledEstHours = hasChildren ? children.reduce((s, c) => s + (c.estimatedHours || 0), 0) : task.estimatedHours;
  const rolledActHours = hasChildren ? children.reduce((s, c) => s + (c.actualHours || 0), 0) : task.actualHours;
  const rolledStatus = hasChildren ? derivedStatus(children) : task.status;
  const isOverdue = !hasChildren && task.dueDate && task.dueDate < today && task.status !== "Done";
  const noteExpanded = expandedNotes?.has(task.id);
  const isDraggable = depth === 0;

  return (
    <>
      <tr
        className={`group align-top border-t ${isDraggedOver ? "border-t-2 border-teal bg-teal-50/30" : "border-gray-100"} hover:bg-slate-50/50 ${isDragging ? "opacity-40" : ""}`}
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
              <div className="flex items-center gap-1">
                <span className={`text-navy ${hasChildren ? "font-semibold" : ""}`}>
                  {task.name}
                  {hasChildren && (
                    <span className="ml-1 text-[10px] font-normal text-gray-400">({children.length})</span>
                  )}
                </span>
                {isOverdue && (
                  <span className="text-red-500 text-[10px] font-semibold bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5 flex-shrink-0">Overdue</span>
                )}
                {depth === 0 && (
                  <button onClick={(e) => { e.stopPropagation(); onAddSubtask(task); }} className="opacity-0 group-hover:opacity-100 transition-opacity text-teal-600 hover:text-teal-700 font-bold text-[13px] px-0.5 leading-none flex-shrink-0" title="Add subtask">+</button>
                )}
                {task.notes?.trim() && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenNote(task); }}
                    className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
                    title="View note"
                  >
                    <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10c0 3.866-3.582 7-8 7a8.8 8.8 0 01-4.043-.98L2 17l1.338-3.123C2.493 12.767 2 11.434 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7zM7 9H5v2h2V9zm8 0h-2v2h2V9zM9 9h2v2H9V9z" clipRule="evenodd"/>
                    </svg>
                  </button>
                )}
              </div>
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
              {membersByRole(task.responsibleRole).map((m) => (
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
          {depth === 0 ? (
            <div className="flex items-center gap-1 group/date">
              <span className={task.dueDate && task.dueDate < today && task.status !== "Done" ? "text-red-600 font-semibold" : ""}>
                {task.dueDate || "—"}
              </span>
              {task.dueDate && task.status !== "Done" && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRequestDCR && onRequestDCR(task); }}
                  className="opacity-0 group-hover/date:opacity-100 transition-opacity ml-1 text-gray-400 hover:text-indigo-600"
                  title="Request deadline change"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </button>
              )}
            </div>
          ) : "—"}
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
            addingSubtaskFor={addingSubtaskFor}
            onCommitSubtask={onCommitSubtask}
            today={today}
            expandedNotes={expandedNotes}
            onToggleNote={onToggleNote}
            onSaveNote={onSaveNote}
            onOpenNote={onOpenNote}
          />
        ))}
      {noteExpanded && (
        <tr className="border-t border-amber-100 bg-amber-50/40">
          <td colSpan={8} style={{ paddingLeft: `${12 + depth * 20 + 28}px` }} className="px-3 py-2 pr-4">
            <textarea
              autoFocus={!task.notes}
              defaultValue={task.notes || ""}
              onBlur={(e) => onSaveNote(task, e.target.value)}
              placeholder="Add a note, link, or context for this task..."
              rows={2}
              className="w-full text-[12px] text-gray-700 border border-amber-200 rounded-md px-2.5 py-1.5 bg-white focus:outline-none focus:ring-1 focus:ring-amber-300 resize-none"
            />
          </td>
        </tr>
      )}
      {expanded && addingSubtaskFor === task.id && (
        <AddSubtaskRow
          depth={1}
          onSave={(name) => onCommitSubtask(task, name)}
          onCancel={() => onCommitSubtask(task, "")}
        />
      )}
    </>
  );
}

function AddSubtaskRow({ depth, onSave, onCancel }) {
  const [name, setName] = useState("");
  return (
    <tr className="border-t border-gray-100 bg-teal-50/30">
      <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + depth * 20}px` }} colSpan={8}>
        <div className="flex items-center gap-2">
          <span className="text-gray-300 text-[11px]">↳</span>
          <input
            autoFocus
            placeholder="Subtask name..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSave(name);
              if (e.key === "Escape") onCancel();
            }}
            className="flex-1 border border-teal-300 rounded-md px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal"
          />
          <button onClick={() => onSave(name)} className="text-[11px] bg-navy text-white px-3 py-1 rounded-md">Add</button>
          <button onClick={onCancel} className="text-[11px] text-gray-500 px-2">Cancel</button>
        </div>
      </td>
    </tr>
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
  const location = useLocation();
  const [intakeBannerDismissed, setIntakeBannerDismissed] = useState(false);
  const showIntakeBanner = location.state?.fromIntake && !intakeBannerDismissed;
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [projectAssignments, setProjectAssignments] = useState({});
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
  const [showChangeRequestModal, setShowChangeRequestModal] = useState(false);
  const [changeRequestDate, setChangeRequestDate] = useState("");
  const [changeRequestReason, setChangeRequestReason] = useState("");
  // Task-level DCR (Deadline Change Request)
  const [showDCRModal, setShowDCRModal]               = useState(false);
  const [dcrTask, setDcrTask]                         = useState(null);
  const [dcrRequestedDate, setDcrRequestedDate]       = useState("");
  const [dcrReason, setDcrReason]                     = useState("");
  const [submittingDCR, setSubmittingDCR]             = useState(false);
  const [dcrs, setDcrs]                               = useState([]);
  const [approvingDCR, setApprovingDCR]               = useState(null);
  const [submittingChangeRequest, setSubmittingChangeRequest] = useState(false);
  const [showCompleteModal, setShowCompleteModal] = useState(false);
  const [completionDate, setCompletionDate] = useState("");
  const [completionNote, setCompletionNote] = useState("");
  const [markingComplete, setMarkingComplete] = useState(false);
  const [draggedTaskId, setDraggedTaskId] = useState(null);
  const [dragOverTaskId, setDragOverTaskId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [showDeleteProjectConfirm, setShowDeleteProjectConfirm] = useState(false);
  const [addingSubtaskFor, setAddingSubtaskFor] = useState(null);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settingsForm, setSettingsForm] = useState(null);
  const [expandedNotes, setExpandedNotes] = useState(new Set());
  const [newNote, setNewNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [notePanel, setNotePanel] = useState(null); // { taskId, taskName, note }
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteError, setNoteError] = useState("");
  const [toast, setToast] = useState("");
  const [projectNotePanel, setProjectNotePanel] = useState(false);

  const [trainingTypes] = useSettingsList("trainingTypes", []);
  const [deliveryFormats] = useSettingsList("deliveryFormats", []);
  const [departments] = useSettingsList("departments", []);

  useEffect(() => {
    const unsubProject = onSnapshot(doc(db, "projects", id), (snap) => {
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    const unsubTasks = onSnapshot(
      query(collection(db, "projects", id, "tasks"), orderBy("order")),
      (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, parentTaskId: null, ...d.data() })))
    );
    const unsubDCRs = onSnapshot(collection(db, "projects", id, "deadlineChangeRequests"), (snap) => {
      setDcrs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    const unsubAssignments = onSnapshot(collection(db, "projects", id, "assignments"), (snap) => {
      const map = {};
      snap.docs.forEach((d) => { map[d.id] = d.data(); });
      setProjectAssignments(map);
    });
    return () => { unsubProject(); unsubTasks(); unsubDCRs(); unsubUsers(); unsubAssignments(); };
  }, [id]);

  const [activityLog, setActivityLog] = useState([]);

  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(
      query(collection(db, "projects", id, "activity"), orderBy("createdAt", "desc")),
      (snap) => setActivityLog(snap.docs.map(d => ({ id: d.id, ...d.data() })).slice(0, 10))
    );
    return unsub;
  }, [id]);

  if (!project) return <p className="text-[13px] text-gray-400 p-4">Loading project...</p>;

  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";
  // Collect all user IDs assigned via Role & Team page
  const assignedUserIds = new Set(
    Object.values(projectAssignments).flatMap(a =>
      (a.assignees ?? []).map(s => s.userId).filter(Boolean)
    )
  );
  // members = union of memberIds + role-assigned users
  const members = users.filter((u) =>
    project?.memberIds?.includes(u.id) || assignedUserIds.has(u.id)
  );
  // For role-filtered task dropdowns: users assigned to a specific role
  const membersByRole = (role) => {
    if (!role) return members;
    const docId = role.replace(/\s+/g, "_");
    const assignment = projectAssignments[docId];
    if (!assignment) return members.filter(u => (u.jobTitle||"") === role);
    const ids = (assignment.assignees ?? []).map(s => s.userId).filter(Boolean);
    return ids.length > 0 ? users.filter(u => ids.includes(u.id)) : members;
  };
  const isApprover = project?.approverId === user?.uid;
  const isOwner = project?.ownerId === user?.uid;

  const topLevelTasks = tasks.filter((t) => !t.parentTaskId);
  const { completionByTaskId, phaseCompletion, projectCompletion, childrenByParent } = computeRollups(tasks);

  const health = project ? computeHealth(project, projectCompletion) : null;
  const today = new Date().toISOString().split("T")[0];
  const overdueTasks = topLevelTasks.filter(
    (t) => t.dueDate && t.dueDate < today && t.status !== "Done"
  );

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

  const addSubtask = (parentTask) => {
    setAddingSubtaskFor(parentTask.id);
    setExpandedTasks((p) => ({ ...p, [parentTask.id]: true }));
  };

  const commitSubtask = async (parentTask, name) => {
    if (!name.trim()) { setAddingSubtaskFor(null); return; }
    const siblingCount = (childrenByParent[parentTask.id] || []).length;
    await addDoc(collection(db, "projects", id, "tasks"), {
      parentTaskId: parentTask.id, phase: parentTask.phase, name: name.trim(), notes: "", responsibleRole: "",
      assigneeId: null, estimatedHours: null, actualHours: null, startDate: null, dueDate: null,
      startDateOverridden: false, actualCompletionDate: null, status: "Not Started", blockedBy: [],
      order: siblingCount + 1,
    });
    setAddingSubtaskFor(null);
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
    const taskSnap = await getDocs(collection(db, "projects", id, "tasks"));
    const batch = writeBatch(db);
    taskSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, "projects", id));
    await batch.commit();
    navigate("/projects");
  };

  const openEditProject = () => {
    setSettingsForm({
      name: project.name || "",
      description: project.description || "",
      ownerId: project.ownerId || "",
      approverId: project.approverId || "",
      priority: project.priority || "Medium",
      trainingType: project.trainingType || "",
      deliveryFormat: project.deliveryFormat || "",
      developmentType: project.developmentType || "",
      smeName: project.smeName || "",
      targetLaunchDate: project.targetLaunchDate || "",
      startDate: project.startDate || "",
      folderUrl: project.folderUrl || "",
      status: PROJECT_STATUSES.includes(project.status) ? project.status : "Active",
      phase: PROJECT_PHASES.includes(project.phase) ? project.phase : "Scoping",
    });
    setShowSettingsPanel(true);
  };

  const saveProjectSettings = async () => {
    if (!(settingsForm?.name || "").trim()) return;
    const prevOwner = project.ownerId;
    const newOwner = settingsForm.ownerId;
    const prevApprover = project.approverId;
    const newApprover = settingsForm.approverId;
    await updateDoc(doc(db, "projects", id), {
      name: (settingsForm.name || "").trim(),
      description: (settingsForm.description || "").trim(),
      ownerId: newOwner,
      approverId: newApprover,
      priority: settingsForm.priority,
      trainingType: settingsForm.trainingType || null,
      deliveryFormat: settingsForm.deliveryFormat || null,
      developmentType: settingsForm.developmentType || null,
      smeName: (settingsForm.smeName || "").trim() || null,
      targetLaunchDate: settingsForm.targetLaunchDate || null,
      startDate: settingsForm.startDate || null,
      folderUrl: (settingsForm.folderUrl || "").trim() || null,
      status: settingsForm.status,
      phase: settingsForm.phase,
    });
    const nameOf = (uid) => users.find((u) => u.id === uid)?.name || uid;
    const logs = ["Project settings updated."];
    if (prevOwner !== newOwner) logs.push(`Ownership transferred from ${nameOf(prevOwner)} to ${nameOf(newOwner)}.`);
    if (prevApprover !== newApprover) logs.push(`Approver changed from ${nameOf(prevApprover)} to ${nameOf(newApprover)}.`);
    await addDoc(collection(db, "projects", id, "activity"), {
      type: prevOwner !== newOwner ? "ownership_transfer" : "edit",
      message: logs.join(" "),
      uid: user.uid,
      createdAt: serverTimestamp(),
    });
    setShowSettingsPanel(false);
  };

  const addNote = async () => {
    if (!newNote.trim()) return;
    setSavingNote(true);
    await addDoc(collection(db, "projects", id, "activity"), {
      type: "note",
      message: newNote.trim(),
      uid: user.uid,
      createdAt: serverTimestamp(),
    });
    setNewNote("");
    setSavingNote(false);
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
      baselineStatus: "Approved",
      baselineEndDate: project.proposedBaselineEndDate,
      baselineRejectionComment: null,
      phase: project.phase === "Scoping" ? "Planning" : project.phase,
    });
  };
  const rejectBaseline = async () => {
    await updateDoc(doc(db, "projects", id), { baselineStatus: "Rejected", baselineRejectionComment: rejectComment });
    setShowReject(false);
    setRejectComment("");
  };

  const effectiveLockedEnd = project.approvedRevisedEndDate || project.baselineEndDate;
  const isSlipping =
    project.baselineStatus === "Approved" &&
    proposedBaseline &&
    effectiveLockedEnd &&
    proposedBaseline > effectiveLockedEnd &&
    project.revisedDeadlineStatus !== "Pending Approval";

  const markProjectComplete = async () => {
    if (!completionDate) return;
    setMarkingComplete(true);
    try {
      const baseline = project.approvedRevisedEndDate || project.baselineEndDate;
      const baselineMs = baseline ? new Date(baseline + "T00:00:00").getTime() : null;
      const actualMs = new Date(completionDate + "T00:00:00").getTime();
      const variance = baselineMs ? Math.round((actualMs - baselineMs) / (1000 * 60 * 60 * 24)) : null;
      await updateDoc(doc(db, "projects", id), {
        status: "Done",
        actualCompletionDate: completionDate,
        completionNote: completionNote.trim() || null,
        scheduleVarianceDays: variance,
        completedAt: serverTimestamp(),
      });
      setShowCompleteModal(false);
    } finally {
      setMarkingComplete(false);
    }
  };

  const openChangeRequestModal = () => {
    setChangeRequestDate(proposedBaseline || effectiveLockedEnd || "");
    setChangeRequestReason("");
    setShowChangeRequestModal(true);
  };

  const submitDeadlineChangeRequest = async () => {
    if (!changeRequestDate || !changeRequestReason.trim()) return;
    setSubmittingChangeRequest(true);
    try {
      await updateDoc(doc(db, "projects", id), {
        revisedDeadlineStatus: "Pending Approval",
        proposedRevisedEndDate: changeRequestDate,
        proposedRevisedEndDateReason: changeRequestReason.trim(),
        revisedDeadlineRejectionComment: null,
      });
      setShowChangeRequestModal(false);
    } finally {
      setSubmittingChangeRequest(false);
    }
  };
  const submitDCR = async () => {
    if (!dcrTask || !dcrRequestedDate || !dcrReason.trim()) return;
    setSubmittingDCR(true);
    try {
      await addDoc(collection(db, "projects", id, "deadlineChangeRequests"), {
        taskId: dcrTask.id,
        taskName: dcrTask.name,
        requestedBy: user.uid,
        requestedByName: profile?.name || user.displayName || user.email,
        currentDueDate: dcrTask.dueDate || null,
        requestedDueDate: dcrRequestedDate,
        reason: dcrReason.trim(),
        status: "Pending",
        createdAt: serverTimestamp(),
        reviewedBy: null,
        reviewedAt: null,
        reviewNote: null,
      });
      setShowDCRModal(false);
      setDcrTask(null);
      setDcrRequestedDate("");
      setDcrReason("");
    } catch (e) {
      console.error("submitDCR error", e);
    } finally {
      setSubmittingDCR(false);
    }
  };

  const approveDCR = async (dcr, approved, note = "") => {
    setApprovingDCR(dcr.id);
    try {
      const dcrRef = doc(db, "projects", id, "deadlineChangeRequests", dcr.id);
      await updateDoc(dcrRef, {
        status: approved ? "Approved" : "Rejected",
        reviewedBy: user.uid,
        reviewedByName: profile?.name || user.displayName || user.email,
        reviewedAt: serverTimestamp(),
        reviewNote: note || null,
      });
      if (approved && dcr.taskId && dcr.requestedDueDate) {
        await updateDoc(doc(db, "projects", id, "tasks", dcr.taskId), {
          dueDate: dcr.requestedDueDate,
        });
      }
    } catch (e) {
      console.error("approveDCR error", e);
    } finally {
      setApprovingDCR(null);
    }
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

  const PLANNING_STAGES = ["Draft / Intake","WBS Pending","Resource Check","Pending Approval","Active","Done"];
  const STAGE_DISPLAY = {
    "Draft / Intake":   "Intake",
    "WBS Pending":      "WBS Effort",
    "Resource Check":   "Resource Check",
    "Pending Approval": "Approval",
    "Active":           "Active",
    "At Risk / Behind": "Active",
    "Done":             "Complete",
  };
  const STAGE_BADGE_STYLES = {
    "Draft / Intake":   "bg-blue-100 text-blue-700",
    "WBS Pending":      "bg-purple-100 text-purple-700",
    "Resource Check":   "bg-orange-100 text-orange-700",
    "Pending Approval": "bg-yellow-100 text-yellow-700",
    "Active":           "bg-emerald-100 text-emerald-700",
    "At Risk / Behind": "bg-red-100 text-red-700",
    "Done":             "bg-gray-100 text-gray-600",
  };
  const PRIORITY_BADGE = {
    High:   "bg-red-100 text-red-700",
    Medium: "bg-amber-100 text-amber-700",
    Low:    "bg-emerald-100 text-emerald-700",
  };
  const WHATS_NEXT = {
    "Draft / Intake":   { desc: "Confirm the estimated hours for each WBS task and select the required roles. This will allow Meridian to calculate total role demand.", cta: "Go to WBS" },
    "WBS Pending":      { desc: "WBS is set. Go to the Capacity Check to confirm team availability before submitting the baseline.", cta: "Go to Capacity" },
    "Resource Check":   { desc: "Resources assigned. Mark Capacity Checked on the Capacity page to unlock baseline submission.", cta: "Go to Capacity" },
    "Pending Approval": { desc: "Baseline submitted and awaiting approval. The Baseline Approver needs to review and approve.", cta: "View Baseline" },
    "Active":           { desc: "Project is active. Track progress in the WBS, update task statuses, and monitor health.", cta: "Go to WBS" },
    "At Risk / Behind": { desc: "This project needs attention. Review the timeline and consider requesting a deadline change or reforecasting.", cta: "Go to WBS" },
    "Done":             { desc: "Project is complete. Review the final summary and close out any remaining tasks.", cta: "View Summary" },
  };

  const planningStage = (() => {
    if (project.planningStatus === "Draft / Intake")    return "Draft / Intake";
    if (project.planningStatus === "WBS Pending")       return "WBS Pending";
    if (project.planningStatus === "Resource Check")    return "Resource Check";
    if (project.baselineStatus  === "Pending Approval") return "Pending Approval";
    const s = project.status || "";
    if (s === "Done" || s === "Canceled")               return "Done";
    if (s === "Active" && (health?.label === "At Risk" || health?.label === "Behind Schedule")) return "At Risk / Behind";
    if (s === "Active")                                 return "Active";
    return "Draft / Intake";
  })();

  const totalWBSHours = topLevelTasks.reduce((s, t) => {
    const kids = childrenByParent[t.id] || [];
    return s + (kids.length ? kids.reduce((cs, c) => cs + (c.estimatedHours || 0), 0) : (t.estimatedHours || 0));
  }, 0);
  const requiredRolesCount = new Set(topLevelTasks.map(t => t.responsibleRole).filter(Boolean)).size;
  const stepperStages = PLANNING_STAGES.filter(s => s !== "At Risk / Behind");
  const activeStepperStage = planningStage === "At Risk / Behind" ? "Active" : planningStage;
  const whatsNext = WHATS_NEXT[planningStage] || WHATS_NEXT["Draft / Intake"];

  return (
    <div>
      <Link to="/projects" className="text-[11px] text-navy underline">← Back to Projects</Link>

      {/* ── Intake next-step banner ── */}
      {showIntakeBanner && (
        <div className="mt-3 mb-2 flex items-start gap-3 bg-teal-50 border border-teal-200 rounded-lg px-4 py-3">
          <span className="text-teal-500 text-lg shrink-0">✶</span>
          <div className="flex-1">
            <div className="text-[13px] font-semibold text-teal-800 mb-0.5">Draft created — WBS generated</div>
            <div className="text-[12px] text-teal-700">
              <strong>Next Step:</strong> Confirm WBS hours and required roles below. Resource planning and scheduling will be calculated after task effort is entered.
            </div>
          </div>
          <button
            onClick={() => setIntakeBannerDismissed(true)}
            className="text-teal-400 hover:text-teal-600 text-[14px] shrink-0 mt-0.5"
            title="Dismiss"
          >✕</button>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex items-start justify-between mt-2 mb-2">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold font-heading text-navy">{project.name}</h2>
            {project.projectCode && <span className="text-[11px] text-gray-400 font-mono">{project.projectCode}</span>}
            {project.ticketNumber && <span className="text-[11px] text-gray-400 font-mono">#{project.ticketNumber}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${STAGE_BADGE_STYLES[planningStage] || "bg-gray-100 text-gray-600"}`}>
            {STAGE_DISPLAY[planningStage] || planningStage}
          </span>
          {(isOwner || profile?.role === "Admin") && (project.status === "Active" || project.planningStatus === "Active") && project.status !== "Done" && (
            <button
              onClick={() => { setCompletionDate(new Date().toISOString().split("T")[0]); setCompletionNote(""); setShowCompleteModal(true); }}
              className="text-[11px] font-medium text-emerald-700 border border-emerald-300 bg-emerald-50 rounded-md px-3 py-1 hover:bg-emerald-100 transition"
            >
              ✓ Mark Complete
            </button>
          )}
          {(isOwner || profile?.role === "Admin") && (
            <button
              onClick={openEditProject}
              className="text-[11px] font-medium text-navy border border-gray-300 bg-white rounded-md px-3 py-1 hover:bg-gray-50 transition"
            >
              Edit Project
            </button>
          )}
          {profile?.role === "Admin" && (
            <button onClick={() => setShowDeleteProjectConfirm(true)} className="text-[11px] text-red-400 hover:text-red-600 border border-red-200 rounded-md px-2.5 py-1 hover:border-red-400 transition">
              Delete
            </button>
          )}
        </div>
      </div>

      {/* ── Meta row ── */}
      <div className="flex items-center gap-5 mb-3 flex-wrap text-[12px]">
        <div className="flex items-center gap-1 text-gray-500">
          <span className="text-[10px] uppercase tracking-wide font-medium text-gray-400">Owner</span>
          <span className="text-navy font-medium ml-1">{nameFor(project.ownerId)}</span>
        </div>
        <span className="text-gray-300">•</span>
        <div className="flex items-center gap-1 text-gray-500">
          <span className="text-[10px] uppercase tracking-wide font-medium text-gray-400">Approver</span>
          <span className="text-navy font-medium ml-1">{nameFor(project.approverId)}</span>
        </div>
        <span className="text-gray-300">•</span>
        <div className="flex items-center gap-1">
          <span className="text-[10px] uppercase tracking-wide font-medium text-gray-400">Priority</span>
          <span className={`ml-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${PRIORITY_BADGE[project.priority] || "bg-gray-100 text-gray-600"}`}>{project.priority || "—"}</span>
        </div>
        <span className="text-gray-300">•</span>
        <div className="flex items-center gap-1 text-gray-500">
          <span className="text-[10px] uppercase tracking-wide font-medium text-gray-400">Target Launch</span>
          <span className="text-navy font-medium ml-1">{project.targetLaunchDate || "—"}</span>
        </div>
        <span className="text-gray-300">•</span>
        <div className="flex items-center gap-1 text-gray-500">
          <span className="text-[10px] uppercase tracking-wide font-medium text-gray-400">Planning Stage</span>
          <span className="text-navy font-medium ml-1">{STAGE_DISPLAY[planningStage] || planningStage}</span>
        </div>
        {project.folderUrl && (
          <>
            <span className="text-gray-300">•</span>
            <a href={project.folderUrl} target="_blank" rel="noreferrer" className="text-[11px] text-teal-700 underline whitespace-nowrap">Project Folder ↗</a>
          </>
        )}
      </div>

      {/* ── Progress stepper ── */}
      <div className="bg-white rounded-lg border border-gray-100 shadow-sm px-5 py-3 mb-4">
        <div className="flex items-center justify-between">
          {stepperStages.map((stage, idx) => {
            const stageIdx = stepperStages.indexOf(activeStepperStage);
            const isPast    = idx < stageIdx;
            const isCurrent = stage === activeStepperStage;
            return (
              <div key={stage} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-1 min-w-0">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border-2 transition-colors ${
                    isCurrent ? "bg-teal border-teal text-white" :
                    isPast    ? "bg-teal/20 border-teal/40 text-teal-700" :
                                "bg-gray-100 border-gray-200 text-gray-400"
                  }`}>
                    {isPast ? "✓" : idx + 1}
                  </div>
                  <span className={`text-[10px] font-medium whitespace-nowrap ${isCurrent ? "text-teal-700" : isPast ? "text-teal-600" : "text-gray-400"}`}>
                    {STAGE_DISPLAY[stage]}
                  </span>
                </div>
                {idx < stepperStages.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-2 mb-4 rounded ${isPast || isCurrent ? "bg-teal/40" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── 3-panel row ── */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* At a Glance */}
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-2">At a Glance</div>
          <div className="space-y-1.5 text-[12px]">
            <div className="flex justify-between">
              <span className="text-gray-500">Work Type</span>
              <span className="text-navy font-medium">{project.workTypeName || project.trainingType || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Dev Level</span>
              <span className="text-navy font-medium">{project.developmentType || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Delivery Format</span>
              <span className="text-navy font-medium">{project.deliveryFormat || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Deadline Flexibility</span>
              <span className="text-navy font-medium">{project.deadlineFlexibility || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Total WBS Effort</span>
              <span className="text-navy font-medium">{totalWBSHours ? `${totalWBSHours} hrs` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Required Roles</span>
              <span className="text-navy font-medium">{requiredRolesCount || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Contributors</span>
              <span className="text-navy font-medium">{(project.memberIds || []).length || "—"}</span>
            </div>
          </div>
        </div>

        {/* Planning Summary */}
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm px-4 py-3">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-2">Planning Summary</div>
          <div className="space-y-1.5 text-[12px]">
            <div className="flex justify-between">
              <span className="text-gray-500">Start Date</span>
              <span className="text-navy font-medium">{project.startDate || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Target Launch</span>
              <span className="text-navy font-medium">{project.targetLaunchDate || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Dev Level</span>
              <span className="text-navy font-medium">{project.developmentType || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Delivery Format</span>
              <span className="text-navy font-medium">{project.deliveryFormat || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Deadline Driver</span>
              <span className="text-navy font-medium">{project.deadlineDriver || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Required Roles</span>
              <span className="text-navy font-medium">{requiredRolesCount || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Status</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${STAGE_BADGE_STYLES[planningStage] || "bg-gray-100 text-gray-500"}`}>{STAGE_DISPLAY[planningStage] || planningStage}</span>
            </div>
            <div className="flex justify-between items-start gap-2">
              <span className="text-gray-500 shrink-0">Your Step</span>
              <span className="text-navy font-medium text-right text-[11px]">{whatsNext.desc.split(".")[0]}.</span>
            </div>
          </div>
        </div>

        {/* Activity Feed */}
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm px-4 py-3 flex flex-col">
          <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-2">Activity Feed</div>
          <div className="flex-1 overflow-y-auto max-h-52 space-y-2">
            {activityLog.length === 0 && (
              <p className="text-[11px] text-gray-400 italic">No activity yet.</p>
            )}
            {activityLog.map((entry) => (
              <div key={entry.id} className="flex flex-col gap-0.5 border-b border-gray-50 pb-1.5 last:border-0">
                <span className="text-[11px] text-gray-700 leading-snug">{entry.message}</span>
                <span className="text-[10px] text-gray-400">
                  {entry.createdAt?.toDate
                    ? entry.createdAt.toDate().toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
                    : ""}
                </span>
              </div>
            ))}
          </div>
          <button
            onClick={() => setProjectNotePanel(true)}
            className="mt-2 text-[10px] text-teal-600 hover:text-teal-800 border border-teal-200 bg-teal-50 rounded-full px-2 py-0.5 hover:bg-teal-100 self-start"
          >
            + Add Note
          </button>
        </div>
      </div>

      {/* ── Execution Health Card (Active projects only) ── */}
      {project.status === "Active" && health && (
        <div className={`rounded-xl border mb-4 px-5 py-4 ${
          health.rag === "red"   ? "bg-red-50 border-red-200" :
          health.rag === "amber" ? "bg-amber-50 border-amber-200" :
          health.rag === "green" ? "bg-emerald-50 border-emerald-200" :
                                    "bg-gray-50 border-gray-200"
        }`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full flex-shrink-0 ${
                health.rag === "red" ? "bg-red-500" : health.rag === "amber" ? "bg-amber-500" : health.rag === "green" ? "bg-emerald-500" : "bg-gray-400"
              }`} />
              <span className={`text-[13px] font-bold ${
                health.rag === "red" ? "text-red-800" : health.rag === "amber" ? "text-amber-800" : health.rag === "green" ? "text-emerald-800" : "text-gray-700"
              }`}>
                {health.label}
              </span>
              {health.isOverridden && <span className="text-[10px] bg-white border rounded-full px-1.5 py-0.5 text-gray-500">Manual override</span>}
            </div>
            <span className="text-[11px] text-gray-400">Execution health</span>
          </div>
          <div className="grid grid-cols-4 gap-4">
            {/* Overall Progress */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Progress</div>
              <div className="flex items-end gap-1 mb-1">
                <span className="text-[22px] font-bold text-navy leading-none">{Math.round(projectCompletion)}</span>
                <span className="text-[13px] text-gray-500 mb-0.5">%</span>
              </div>
              <div className="w-full bg-white/60 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all ${health.rag === "green" ? "bg-emerald-500" : health.rag === "amber" ? "bg-amber-500" : "bg-red-500"}`}
                  style={{ width: `${Math.round(projectCompletion)}%` }}
                />
              </div>
            </div>
            {/* Overdue Tasks */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Overdue Tasks</div>
              <div className="flex items-end gap-1">
                <span className={`text-[22px] font-bold leading-none ${overdueTasks.length > 0 ? "text-red-600" : "text-navy"}`}>
                  {overdueTasks.length}
                </span>
                <span className="text-[13px] text-gray-500 mb-0.5">tasks</span>
              </div>
              {overdueTasks.length > 0 && (
                <p className="text-[10px] text-red-500 mt-0.5">Need attention</p>
              )}
            </div>
            {/* Days Remaining */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Days Remaining</div>
              {(() => {
                const end = project.approvedRevisedEndDate || project.baselineEndDate || project.targetLaunchDate;
                if (!end) return <span className="text-[13px] text-gray-400">—</span>;
                const diff = Math.ceil((new Date(end + "T00:00:00") - new Date()) / 86400000);
                return (
                  <>
                    <div className="flex items-end gap-1">
                      <span className={`text-[22px] font-bold leading-none ${diff < 0 ? "text-red-600" : diff <= 7 ? "text-amber-600" : "text-navy"}`}>
                        {Math.abs(diff)}
                      </span>
                      <span className="text-[13px] text-gray-500 mb-0.5">{diff < 0 ? "overdue" : "left"}</span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-0.5">Deadline: {end}</p>
                  </>
                );
              })()}
            </div>
            {/* Total Tasks */}
            <div>
              <div className="text-[10px] uppercase tracking-wide text-gray-500 font-semibold mb-1">Task Status</div>
              {(() => {
                const done = tasks.filter(t => t.status === "Done").length;
                const rfc  = tasks.filter(t => t.status === "Ready for Completion").length;
                const total = tasks.length;
                return (
                  <>
                    <div className="flex items-end gap-1">
                      <span className="text-[22px] font-bold text-navy leading-none">{done}</span>
                      <span className="text-[13px] text-gray-500 mb-0.5">/{total}</span>
                    </div>
                    {rfc > 0 && <p className="text-[10px] text-purple-600 mt-0.5">{rfc} ready to close</p>}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── What's Next? ── */}
      <div className="bg-teal-50 border border-teal-200 rounded-lg px-5 py-3.5 mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="text-[12px] font-semibold text-teal-800 mb-0.5">What’s Next?</div>
          <p className="text-[12px] text-teal-700 max-w-2xl">{whatsNext.desc}</p>
        </div>
        <Link
          to={
            planningStage === "WBS Pending"     ? `/projects/${id}/capacity` :
            planningStage === "Resource Check"   ? `/projects/${id}/capacity` :
            planningStage === "Pending Approval" ? `/projects/${id}/baseline` :
            planningStage === "Active"           ? `/projects/${id}/wbs` :
            planningStage === "At Risk / Behind" ? `/projects/${id}/wbs` :
            planningStage === "Done"             ? `/projects/${id}/baseline` :
            `/projects/${id}/wbs`
          }
          className="shrink-0 text-[11px] font-semibold bg-teal text-navy px-3 py-1.5 rounded-md border border-teal/60 hover:bg-teal/80 transition whitespace-nowrap"
        >
          {whatsNext.cta} →
        </Link>
      </div>

      {/* ── Deadline Flexibility Health Banner ── */}
      {(health?.label === "At Risk" || health?.label === "Behind Schedule") && (() => {
        const flex = project.deadlineFlexibility || "Flexible";
        const isBehind = health.label === "Behind Schedule";

        const config = {
          Fixed: {
            bg:   "bg-red-50 border-red-300",
            icon: "text-red-500",
            head: "text-red-800",
            body: "text-red-700",
            badge: "bg-red-100 text-red-700 border border-red-200",
            title: isBehind
              ? "⚠️ Fixed deadline — schedule has slipped"
              : "⚠️ Fixed deadline — at risk",
            msg: isBehind
              ? "This project has a fixed, non-negotiable deadline and is currently behind schedule. Escalate immediately and consider submitting a formal deadline change request or descoping."
              : "This project is at risk and has a fixed deadline with no room to move. Immediate corrective action is needed to protect the committed date.",
          },
          Flexible: {
            bg:   "bg-amber-50 border-amber-300",
            icon: "text-amber-500",
            head: "text-amber-800",
            body: "text-amber-700",
            badge: "bg-amber-100 text-amber-700 border border-amber-200",
            title: isBehind
              ? "Schedule has slipped — flexible deadline"
              : "Deadline at risk — flexible",
            msg: isBehind
              ? "This project is behind schedule. The deadline has some flexibility, but stakeholders should be informed and a revised timeline agreed on soon."
              : "This project is at risk. While the deadline has some flexibility, review the remaining effort and assess whether the target date still holds.",
          },
          Negotiable: {
            bg:   "bg-amber-50 border-amber-200",
            icon: "text-amber-400",
            head: "text-amber-700",
            body: "text-amber-600",
            badge: "bg-amber-50 text-amber-600 border border-amber-200",
            title: isBehind
              ? "Schedule has slipped — open to negotiation"
              : "Deadline at risk — negotiable",
            msg: isBehind
              ? "This project is behind schedule. The deadline is negotiable — consider initiating a conversation with stakeholders on a revised target before it becomes critical."
              : "This project is at risk. The deadline is open to negotiation — consider a proactive discussion with stakeholders before the situation escalates.",
          },
        };
        const c = config[flex] || config.Flexible;
        return (
          <div className={"border rounded-lg px-5 py-3.5 mb-4 " + c.bg}>
            <div className="flex items-start gap-3">
              <svg className={"w-4 h-4 mt-0.5 flex-shrink-0 " + c.icon} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className={"text-[12px] font-semibold " + c.head}>{c.title}</span>
                  <span className={"text-[10px] font-semibold px-1.5 py-0.5 rounded " + c.badge}>
                    {flex} Deadline
                  </span>
                </div>
                <p className={"text-[12px] " + c.body}>{c.msg}</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Baseline deadline ── */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1">Baseline Deadline — {project.baselineStatus}</div>
            {project.baselineStatus === "Approved" ? (
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
            {(isOwner || profile?.role === "Admin") && (project.baselineStatus === "Not Submitted" || project.baselineStatus === "Rejected") && (
              <button onClick={submitBaseline} disabled={!proposedBaseline && !manualBaseline} className="text-[11px] bg-navy text-white px-3 py-1.5 rounded-md disabled:opacity-40">
                Submit Baseline for Approval
              </button>
            )}
            {(isApprover || profile?.role === "Admin") && project.baselineStatus === "Pending Approval" && !showReject && (
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

      {/* ── Deadline slipping alert ── */}
      {isSlipping && project.revisedDeadlineStatus !== "Pending Approval" && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[13px] font-semibold text-amber-800 mb-0.5">⚠ Schedule is slipping</p>
            <p className="text-[12px] text-amber-700">
              Task hours compute an end date of <strong>{proposedBaseline}</strong>, past the locked baseline of <strong>{effectiveLockedEnd}</strong>.
              A formal revision request is needed to keep the deadline accurate.
            </p>
          </div>
          {(isOwner || profile?.role === "Admin") && (
            <button onClick={openChangeRequestModal} className="shrink-0 text-[11px] bg-amber-700 text-white px-3 py-1.5 rounded-md font-medium hover:bg-amber-800 transition-colors whitespace-nowrap">
              Request Deadline Change
            </button>
          )}
        </div>
      )}

      {/* Project Lead can always request a deadline change on active projects */}
      {project.baselineStatus === "Approved" && !isSlipping && project.revisedDeadlineStatus !== "Pending Approval" && (isOwner || profile?.role === "Admin") && (
        <div className="flex justify-end mb-3">
          <button onClick={openChangeRequestModal} className="text-[11px] text-gray-500 hover:text-navy border border-gray-200 hover:border-gray-400 px-3 py-1.5 rounded-md transition-colors">
            Request Deadline Change
          </button>
        </div>
      )}

      {/* ── Pending approval banner ── */}
      {project.revisedDeadlineStatus === "Pending Approval" && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] font-semibold text-blue-800 mb-1">📋 Deadline change request pending</p>
              <p className="text-[12px] text-blue-700">
                Proposed new deadline: <strong>{project.proposedRevisedEndDate}</strong>
              </p>
              {project.proposedRevisedEndDateReason && (
                <p className="text-[12px] text-blue-600 mt-1 italic">"{project.proposedRevisedEndDateReason}"</p>
              )}
            </div>
            {isApprover && !showRevisedReject && (
              <div className="flex gap-2 shrink-0">
                <button onClick={approveDeadlineChange} className="text-[11px] bg-teal-600 text-white font-medium px-3 py-1.5 rounded-md hover:bg-teal-700 transition-colors">Approve</button>
                <button onClick={() => setShowRevisedReject(true)} className="text-[11px] border border-gray-300 px-3 py-1.5 rounded-md text-gray-600 hover:bg-gray-50 transition-colors">Reject</button>
              </div>
            )}
          </div>
          {showRevisedReject && (
            <div className="mt-3 flex gap-2">
              <input
                placeholder="Reason for rejection (required)"
                value={revisedRejectComment}
                onChange={(e) => setRevisedRejectComment(e.target.value)}
                className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-red-300"
              />
              <button onClick={rejectDeadlineChange} disabled={!revisedRejectComment.trim()} className="text-[11px] bg-red-500 text-white px-3 py-1.5 rounded-md disabled:opacity-40 hover:bg-red-600 transition-colors">Confirm Reject</button>
              <button onClick={() => setShowRevisedReject(false)} className="text-[11px] border border-gray-300 px-3 py-1.5 rounded-md text-gray-500 hover:bg-gray-50 transition-colors">Cancel</button>
            </div>
          )}
        </div>
      )}

      {/* ── Rejected — allow resubmit ── */}
      {project.revisedDeadlineStatus === "Rejected" && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[13px] font-semibold text-red-700 mb-0.5">✕ Deadline change request rejected</p>
              {project.revisedDeadlineRejectionComment && (
                <p className="text-[12px] text-red-600 italic">"{project.revisedDeadlineRejectionComment}"</p>
              )}
            </div>
            {(isOwner || profile?.role === "Admin") && (
              <button onClick={openChangeRequestModal} className="shrink-0 text-[11px] bg-red-600 text-white px-3 py-1.5 rounded-md font-medium hover:bg-red-700 transition-colors whitespace-nowrap">
                Resubmit Request
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Mark Project Complete Modal ── */}
      {showCompleteModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-base font-bold text-navy mb-1">Mark Project Complete</h2>
            <p className="text-[12px] text-gray-500 mb-4">
              This will lock the project and record the actual completion date. The variance against the baseline will be calculated automatically.
            </p>

            {(project.approvedRevisedEndDate || project.baselineEndDate) && (
              <div className="bg-gray-50 rounded-lg px-3 py-2 mb-4 text-[12px] text-gray-600">
                Baseline deadline: <strong>{project.approvedRevisedEndDate || project.baselineEndDate}</strong>
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Actual Completion Date <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={completionDate}
                  onChange={(e) => setCompletionDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
                {completionDate && (project.approvedRevisedEndDate || project.baselineEndDate) && (() => {
                  const baseline = project.approvedRevisedEndDate || project.baselineEndDate;
                  const diff = Math.round((new Date(completionDate + "T00:00:00") - new Date(baseline + "T00:00:00")) / (1000*60*60*24));
                  return diff === 0 ? (
                    <p className="text-[11px] text-emerald-600 mt-1">✓ On time — delivered on baseline date</p>
                  ) : diff < 0 ? (
                    <p className="text-[11px] text-emerald-600 mt-1">✓ {Math.abs(diff)} day{Math.abs(diff) > 1 ? "s" : ""} early</p>
                  ) : (
                    <p className="text-[11px] text-red-500 mt-1">⚠ {diff} day{diff > 1 ? "s" : ""} late vs baseline</p>
                  );
                })()}
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Closing Note (optional)
                </label>
                <textarea
                  rows={2}
                  value={completionNote}
                  onChange={(e) => setCompletionNote(e.target.value)}
                  placeholder="Any notes on delivery, lessons learned, or handoff…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5 justify-end">
              <button onClick={() => setShowCompleteModal(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button
                onClick={markProjectComplete}
                disabled={!completionDate || markingComplete}
                className="px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg font-medium disabled:opacity-40 hover:bg-emerald-700 transition-colors"
              >
                {markingComplete ? "Saving…" : "Confirm Complete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Task DCR submission modal ── */}
      {showDCRModal && dcrTask && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-navy font-heading">Request Deadline Change</h3>
              <button onClick={() => setShowDCRModal(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Task</label>
                <p className="text-[13px] text-navy font-medium">{dcrTask.name}</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Current Due Date</label>
                  <p className="text-[13px] text-gray-600">{dcrTask.dueDate || "—"}</p>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Requested New Date <span className="text-red-400">*</span></label>
                  <input
                    type="date"
                    value={dcrRequestedDate}
                    min={today}
                    onChange={(e) => setDcrRequestedDate(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Reason <span className="text-red-400">*</span></label>
                <textarea
                  rows={3}
                  value={dcrReason}
                  onChange={(e) => setDcrReason(e.target.value)}
                  placeholder="Explain why the deadline needs to change and what the impact is…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setShowDCRModal(false)} className="px-4 py-2 text-[13px] border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">
                Cancel
              </button>
              <button
                onClick={submitDCR}
                disabled={!dcrRequestedDate || !dcrReason.trim() || submittingDCR}
                className="px-4 py-2 text-[13px] bg-indigo-600 text-white rounded-lg font-semibold disabled:opacity-40 hover:bg-indigo-700 transition"
              >
                {submittingDCR ? "Submitting…" : "Submit Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Deadline Change Request Modal ── */}
      {showChangeRequestModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h2 className="text-base font-bold text-navy mb-1">Request Deadline Change</h2>
            <p className="text-[12px] text-gray-500 mb-4">
              Current locked deadline: <strong>{effectiveLockedEnd || "—"}</strong>
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Proposed New Deadline <span className="text-red-400">*</span>
                </label>
                <input
                  type="date"
                  value={changeRequestDate}
                  min={effectiveLockedEnd || undefined}
                  onChange={(e) => setChangeRequestDate(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-gray-600 uppercase tracking-wide mb-1">
                  Reason / Justification <span className="text-red-400">*</span>
                </label>
                <textarea
                  rows={3}
                  value={changeRequestReason}
                  onChange={(e) => setChangeRequestReason(e.target.value)}
                  placeholder="Explain why the deadline needs to change…"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-400"
                />
              </div>
            </div>

            <div className="flex gap-2 mt-5 justify-end">
              <button
                onClick={() => setShowChangeRequestModal(false)}
                className="px-4 py-2 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitDeadlineChangeRequest}
                disabled={!changeRequestDate || !changeRequestReason.trim() || submittingChangeRequest}
                className="px-4 py-2 text-sm bg-navy text-white rounded-lg font-medium disabled:opacity-40 hover:opacity-90 transition-opacity"
              >
                {submittingChangeRequest ? "Submitting…" : "Submit Request"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Task list ── */}
      {project.planningStatus !== "Active" && project.status !== "Active" && project.status !== "Done" && project.status !== "On Hold" ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-5 py-10 flex flex-col items-center justify-center text-center gap-3">
            <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <div>
              <p className="text-[13px] font-semibold text-gray-700 mb-1">Task tracker is locked</p>
              <p className="text-[12px] text-gray-400 max-w-sm">
                Complete the WBS and resource planning flow first. The task tracker unlocks once the baseline is approved and the project goes Active.
              </p>
            </div>
            <Link
              to={`/projects/${id}/wbs`}
              className="mt-1 inline-flex items-center gap-1.5 text-[12px] font-semibold px-4 py-2 rounded-lg text-white transition hover:opacity-90"
              style={{ backgroundColor: "#0F2240" }}
            >
              Go to WBS →
            </Link>
          </div>
        </div>
      ) : (
      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        {/* ── DCR Approval Queue (visible only to dueDateApproverId) ── */}
        {dcrs.filter(d => d.status === "Pending").length > 0 && project.dueDateApproverId === user?.uid && (
          <div className="border-b border-indigo-100 bg-indigo-50 px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-indigo-800">Pending Deadline Change Requests</span>
                <span className="bg-indigo-600 text-white text-[10px] font-bold rounded-full px-2 py-0.5">
                  {dcrs.filter(d => d.status === "Pending").length}
                </span>
              </div>
            </div>
            <div className="space-y-2">
              {dcrs.filter(d => d.status === "Pending").map((dcr) => (
                <div key={dcr.id} className="bg-white rounded-lg border border-indigo-200 px-3 py-2.5 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-semibold text-navy truncate">{dcr.taskName}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500">
                      <span>Current: <span className="font-medium text-gray-700">{dcr.currentDueDate || "—"}</span></span>
                      <span>→</span>
                      <span>Requested: <span className="font-medium text-indigo-700">{dcr.requestedDueDate}</span></span>
                    </div>
                    <p className="text-[11px] text-gray-500 mt-1 italic">"{dcr.reason}"</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">Requested by {dcr.requestedByName || "team member"}</p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => approveDCR(dcr, true)}
                      disabled={approvingDCR === dcr.id}
                      className="text-[11px] font-semibold bg-emerald-600 text-white rounded-lg px-2.5 py-1.5 hover:bg-emerald-700 disabled:opacity-40 transition"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => approveDCR(dcr, false)}
                      disabled={approvingDCR === dcr.id}
                      className="text-[11px] font-semibold bg-white border border-red-300 text-red-600 rounded-lg px-2.5 py-1.5 hover:bg-red-50 disabled:opacity-40 transition"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
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
                        addingSubtaskFor={addingSubtaskFor}
                        onCommitSubtask={commitSubtask}
                        today={today}
                        expandedNotes={expandedNotes}
                        onToggleNote={(taskId) => setExpandedNotes((prev) => {
                          const next = new Set(prev);
                          next.has(taskId) ? next.delete(taskId) : next.add(taskId);
                          return next;
                        })}
                        onSaveNote={(task, val) => updateDoc(doc(db, "projects", id, "tasks", task.id), { notes: val.trim() || null })}
                        onOpenNote={(task) => setNotePanel({ taskId: task.id, taskName: task.name, note: task.notes || "" })}
                        onRequestDCR={(task) => { setDcrTask(task); setDcrRequestedDate(task.dueDate || ""); setDcrReason(""); setShowDCRModal(true); }}
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
      )}

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
          <button className="w-full text-left px-3 py-1.5 text-[12px] text-gray-700 hover:bg-slate-50"
            onClick={() => {
              setNotePanel({ taskId: contextMenu.task.id, taskName: contextMenu.task.name, note: contextMenu.task.notes || "" });
              setContextMenu(null);
            }}>
            {contextMenu.task.notes ? "📝 View/Edit Note" : "🗒 Add Note"}
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
              <button onClick={() => setShowDeleteProjectConfirm(false)} className="px-4 py-2 text-[12px] border border-gray-300 rounded-md text-gray-600 hover:bg-slate-50">Cancel</button>
              <button onClick={deleteProject} className="px-4 py-2 text-[12px] bg-red-600 text-white rounded-md hover:bg-red-700">Yes, delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Project Settings Side Panel ── */}
      {showSettingsPanel && settingsForm && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setShowSettingsPanel(false)} />
          <div className="fixed right-0 top-0 h-full w-[420px] bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200 overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
              <div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Project Settings</div>
                <div className="text-[13px] font-semibold text-navy">{project.name}</div>
              </div>
              <button onClick={() => setShowSettingsPanel(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
            <div className="flex-1 px-5 py-4 space-y-4">
              {/* Name + description */}
              {[["Project Name", "name", "text"], ["Description", "description", "textarea"]].map(([label, key, type]) => (
                <div key={key}>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">{label}</label>
                  {type === "textarea"
                    ? <textarea rows={2} value={settingsForm[key]} onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal resize-none" />
                    : <input type="text" value={settingsForm[key]} onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal" />}
                </div>
              ))}
              <hr className="border-gray-100" />
              {/* Status + Phase */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">Status</label>
                  <select value={settingsForm.status} onChange={(e) => setSettingsForm({ ...settingsForm, status: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal">
                    {PROJECT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">Phase</label>
                  <select value={settingsForm.phase} onChange={(e) => setSettingsForm({ ...settingsForm, phase: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal">
                    {PROJECT_PHASES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              </div>
              <hr className="border-gray-100" />
              {/* People */}
              <div className="grid grid-cols-2 gap-3">
                {[["Owner", "ownerId"], ["Approver", "approverId"]].map(([label, key]) => (
                  <div key={key}>
                    <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">{label}</label>
                    <select value={settingsForm[key]} onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal">
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                ))}
                <div className="col-span-2">
                  <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">SME Name</label>
                  <input type="text" placeholder="Subject Matter Expert…" value={settingsForm.smeName} onChange={(e) => setSettingsForm({ ...settingsForm, smeName: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal" />
                </div>
              </div>
              <hr className="border-gray-100" />
              {/* Classification */}
              <div className="grid grid-cols-2 gap-3">
                {[["Priority", "priority", ["Critical","High","Medium","Low"]], ["Development Type", "developmentType", ["","Level 1","Level 2","Level 3"]]].map(([label, key, opts]) => (
                  <div key={key}>
                    <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">{label}</label>
                    <select value={settingsForm[key]} onChange={(e) => setSettingsForm({ ...settingsForm, [key]: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal">
                      {opts.map(o => <option key={o} value={o}>{o || "— Select —"}</option>)}
                    </select>
                  </div>
                ))}
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">Training Type</label>
                  <select value={settingsForm.trainingType} onChange={(e) => setSettingsForm({ ...settingsForm, trainingType: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal">
                    <option value="">— Select —</option>
                    {trainingTypes.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">Delivery Format</label>
                  <select value={settingsForm.deliveryFormat} onChange={(e) => setSettingsForm({ ...settingsForm, deliveryFormat: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal">
                    <option value="">— Select —</option>
                    {deliveryFormats.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
              </div>
              <hr className="border-gray-100" />
              {/* Dates */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">
                    Start Date{project.baselineStatus === "Approved" ? " (locked)" : ""}
                  </label>
                  <input type="date" value={settingsForm.startDate} onChange={(e) => setSettingsForm({ ...settingsForm, startDate: e.target.value })} disabled={project.baselineStatus === "Approved"} className={`w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal ${project.baselineStatus === "Approved" ? "opacity-50 cursor-not-allowed bg-gray-50" : ""}`} />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">Target Launch Date</label>
                  <input type="date" value={settingsForm.targetLaunchDate} onChange={(e) => setSettingsForm({ ...settingsForm, targetLaunchDate: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal" />
                </div>
              </div>
              <hr className="border-gray-100" />
              {/* Folder URL */}
              <div>
                <label className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1 block">Project Folder URL</label>
                <input type="url" placeholder="https://…" value={settingsForm.folderUrl} onChange={(e) => setSettingsForm({ ...settingsForm, folderUrl: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal" />
              </div>
            </div>
            <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-3">
              <button onClick={() => setShowSettingsPanel(false)} className="flex-1 py-2 text-[13px] border border-gray-300 rounded-md text-gray-600 hover:bg-slate-50">Cancel</button>
              <button
                onClick={saveProjectSettings}
                disabled={!(settingsForm.name || "").trim()}
                className="flex-1 py-2 text-[13px] bg-navy text-white rounded-md hover:bg-navy-light disabled:opacity-40"
              >Update Project Settings</button>
            </div>
          </div>
        </>
      )}

      {/* ── Task Note Side Panel ── */}
      {notePanel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setNotePanel(null)} />
          <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Task Note</div>
                <div className="text-[13px] font-semibold text-navy truncate max-w-[220px]">{notePanel.taskName}</div>
              </div>
              <button onClick={() => setNotePanel(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
            <div className="flex-1 p-4 flex flex-col gap-3">
              <textarea
                autoFocus
                value={notePanel.note}
                onChange={(e) => { const v = e.target.value; setNotePanel((p) => ({ ...p, note: v })); }}
                placeholder="Add a note, link, or context…"
                rows={6}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal resize-none"
              />
              <div className="flex gap-2">
                {noteError && <p className="text-red-500 text-[11px]">{noteError}</p>}
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    setNoteSaving(true);
                    setNoteError("");
                    try {
                      const savedNote = notePanel.note.trim() || null;
                      const savedTaskId = notePanel.taskId;
                      await updateDoc(doc(db, "projects", id, "tasks", savedTaskId), { notes: savedNote });
                      // Optimistic update so bubble appears immediately without waiting for onSnapshot
                      setTasks((prev) => prev.map((t) => t.id === savedTaskId ? { ...t, notes: savedNote } : t));
                      setNotePanel(null);
                      setToast("Note saved.");
                      setTimeout(() => setToast(""), 2500);
                    } catch (err) {
                      setNoteError("Save failed: " + err.message);
                    } finally {
                      setNoteSaving(false);
                    }
                  }}
                  disabled={noteSaving}
                  className="flex-1 bg-navy text-white rounded-md py-1.5 text-[12px] font-medium disabled:opacity-50"
                >{noteSaving ? "Saving…" : "Save Note"}</button>
                <button onClick={() => setNotePanel(null)} className="px-3 py-1.5 text-[12px] border border-gray-300 rounded-md text-gray-600">Cancel</button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Project Notes Side Panel ── */}
      {projectNotePanel && (
        <>
          <div className="fixed inset-0 z-40 bg-black/20" onClick={() => setProjectNotePanel(false)} />
          <div className="fixed right-0 top-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div>
                <div className="text-[10px] text-gray-400 uppercase tracking-wide">Notes & Activity</div>
                <div className="text-[13px] font-semibold text-navy truncate max-w-[280px]">{project.name}</div>
              </div>
              <button onClick={() => setProjectNotePanel(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
            </div>
            <div className="px-4 pt-3 pb-2 border-b border-gray-100">
              <div className="flex gap-2">
                <textarea
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addNote(); } }}
                  placeholder="Add a note… (Enter to post)"
                  rows={2}
                  className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal resize-none"
                />
                <button onClick={addNote} disabled={savingNote || !newNote.trim()} className="px-3 py-1.5 text-[12px] bg-navy text-white rounded-md self-end disabled:opacity-40">Post</button>
              </div>
            </div>
            <ProjectActivityFeed projectId={id} users={users} />
          </div>
        </>
      )}

      {/* ── Toast notification ── */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[100] bg-navy text-white text-[12px] px-4 py-2 rounded-lg shadow-lg animate-pulse">
          ✓ {toast}
        </div>
      )}
    </div>
  );
}

function ProjectActivityFeed({ projectId, users }) {
  const [log, setLog] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "projects", projectId, "activity"), orderBy("createdAt", "desc")),
      (snap) => setLog(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, [projectId]);

  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "Someone";
  const fmt = (ts) => {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
      {log.length === 0 && <p className="text-[12px] text-gray-400 italic">No notes yet.</p>}
      {log.map((entry) => (
        <div key={entry.id} className={`text-[12px] ${entry.type === "note" ? "bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5" : "text-gray-400 border-l-2 border-gray-200 pl-2"}`}>
          {entry.type === "note" ? (
            <>
              <div className="flex items-center gap-1.5 mb-1">
                <div className="w-5 h-5 rounded-full bg-navy text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                  {nameFor(entry.uid).split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase()}
                </div>
                <span className="font-medium text-navy">{nameFor(entry.uid)}</span>
                <span className="text-gray-400 text-[10px] ml-auto">{fmt(entry.createdAt)}</span>
              </div>
              <p className="text-gray-700 text-[12px] leading-relaxed">{entry.message}</p>
            </>
          ) : (
            <p className="text-[11px]">🔧 {entry.message} · <span>{fmt(entry.createdAt)}</span></p>
          )}
        </div>
      ))}
    </div>
  );
}

function ActivityLog({ projectId, user, users, newNote, setNewNote, addNote, savingNote }) {
  const [log, setLog] = useState([]);
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, "projects", projectId, "activity"), orderBy("createdAt", "desc")),
      (snap) => setLog(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    return unsub;
  }, [projectId]);

  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "Someone";
  const formatDate = (ts) => {
    if (!ts) return "";
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-5 mt-4">
      <h3 className="text-[12px] font-semibold text-gray-500 uppercase tracking-wide mb-3">Notes & Activity</h3>
      <div className="flex gap-2 mb-4">
        <textarea
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); addNote(); } }}
          placeholder="Add a note or update… (Enter to save)"
          rows={2}
          className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal resize-none"
        />
        <button onClick={addNote} disabled={savingNote || !newNote.trim()} className="px-4 py-2 text-[12px] bg-navy text-white rounded-md self-end disabled:opacity-40">Post</button>
      </div>
      {log.length === 0 && <p className="text-[12px] text-gray-400 italic">No notes yet.</p>}
      <div className="space-y-2">
        {log.map((entry) => (
          <div key={entry.id} className={`flex gap-3 text-[12px] ${entry.type === "note" ? "bg-amber-50/40 border border-amber-100 rounded-md px-3 py-2" : "px-1 py-1 text-gray-400"}`}>
            {entry.type === "note" ? (
              <>
                <div className="w-6 h-6 rounded-full bg-navy text-white text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                  {nameFor(entry.uid).split(" ").map(w => w[0]).join("").slice(0,2).toUpperCase()}
                </div>
                <div>
                  <span className="font-medium text-navy">{nameFor(entry.uid)}</span>
                  <span className="text-gray-400 ml-2 text-[11px]">{formatDate(entry.createdAt)}</span>
                  <p className="text-gray-700 mt-0.5">{entry.message}</p>
                </div>
              </>
            ) : (
              <p className="text-[11px]">🔧 {entry.message} <span className="ml-1">{formatDate(entry.createdAt)}</span></p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}