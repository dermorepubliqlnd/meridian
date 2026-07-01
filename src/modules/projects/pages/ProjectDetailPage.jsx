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
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { computeSchedule } from "../../../lib/scheduling";
import { useAuth } from "../../../context/AuthContext";

const STATUSES = ["Not Started", "In Progress", "Blocked", "Done"];

function EditTaskRow({ task, members, onCancel, onSaved }) {
  const [edit, setEdit] = useState({
    assigneeId: task.assigneeId || "",
    estimatedHours: task.estimatedHours || "",
    status: task.status || "Not Started",
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    await onSaved({
      assigneeId: edit.assigneeId || null,
      estimatedHours: edit.estimatedHours ? Number(edit.estimatedHours) : null,
      status: edit.status,
    });
    setSaving(false);
  };

  return (
    <tr className="border-t border-gray-100 bg-slate-50">
      <td className="px-3 py-2">
        <div className="text-navy">{task.name}</div>
        <div className="text-[11px] text-gray-400">{task.notes}</div>
      </td>
      <td className="px-3 py-2 text-gray-600">{task.responsibleRole}</td>
      <td className="px-3 py-2">
        <select
          value={edit.assigneeId}
          onChange={(e) => setEdit({ ...edit, assigneeId: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-[11px]"
        >
          <option value="">Unassigned</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="number"
          min="0"
          step="0.5"
          value={edit.estimatedHours}
          onChange={(e) => setEdit({ ...edit, estimatedHours: e.target.value })}
          placeholder="hrs"
          className="w-20 border border-gray-300 rounded-md px-2 py-1 text-[11px]"
        />
      </td>
      <td className="px-3 py-2 text-[11px] text-gray-400">auto</td>
      <td className="px-3 py-2">
        <select
          value={edit.status}
          onChange={(e) => setEdit({ ...edit, status: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-[11px]"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <button
          onClick={save}
          disabled={saving}
          className="text-[11px] bg-navy text-white px-2 py-1 rounded-md mr-2 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button onClick={onCancel} className="text-[11px] text-gray-500">
          Cancel
        </button>
      </td>
    </tr>
  );
}

function AddTaskRow({ onCancel, onAdd }) {
  const [form, setForm] = useState({ name: "", notes: "", responsibleRole: "", phase: "Tasks" });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    await onAdd(form);
    setSaving(false);
  };

  return (
    <tr className="border-t border-gray-100 bg-slate-50">
      <td className="px-3 py-2">
        <input
          placeholder="Task name"
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-[11px] mb-1"
        />
        <input
          placeholder="Notes (optional)"
          value={form.notes}
          onChange={(e) => setForm({ ...form, notes: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-[11px]"
        />
      </td>
      <td className="px-3 py-2">
        <input
          placeholder="Role"
          value={form.responsibleRole}
          onChange={(e) => setForm({ ...form, responsibleRole: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-[11px]"
        />
      </td>
      <td className="px-3 py-2 text-[11px] text-gray-400" colSpan={3}>
        Set assignee/hours after adding
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <button
          onClick={save}
          disabled={saving}
          className="text-[11px] bg-navy text-white px-2 py-1 rounded-md mr-2 disabled:opacity-50"
        >
          {saving ? "Adding..." : "Add"}
        </button>
        <button onClick={onCancel} className="text-[11px] text-gray-500">
          Cancel
        </button>
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
  const [editingId, setEditingId] = useState(null);
  const [addingTask, setAddingTask] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const [showReject, setShowReject] = useState(false);

  useEffect(() => {
    const unsubProject = onSnapshot(doc(db, "projects", id), (snap) => {
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    const unsubTasks = onSnapshot(
      query(collection(db, "projects", id, "tasks"), orderBy("order")),
      (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => {
      unsubProject();
      unsubTasks();
      unsubUsers();
    };
  }, [id]);

  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";
  const members = users.filter((u) => project?.memberIds?.includes(u.id));
  const isApprover = project?.approverId === user?.uid;
  const isOwner = project?.ownerId === user?.uid;

  const scheduledDueDates = tasks.filter((t) => t.dueDate).map((t) => t.dueDate);
  const proposedBaseline = scheduledDueDates.length
    ? scheduledDueDates.sort().at(-1)
    : null;

  const saveTask = async (taskId, changes) => {
    const updatedTasks = tasks.map((t) => (t.id === taskId ? { ...t, ...changes } : t));
    const scheduled = computeSchedule(updatedTasks, project.startDate);

    const batch = writeBatch(db);
    scheduled.forEach((t) => {
      batch.update(doc(db, "projects", id, "tasks", t.id), {
        assigneeId: t.assigneeId,
        estimatedHours: t.estimatedHours,
        status: t.status,
        startDate: t.startDate,
        dueDate: t.dueDate,
      });
    });
    await batch.commit();
    setEditingId(null);
  };

  const addManualTask = async (form) => {
    await addDoc(collection(db, "projects", id, "tasks"), {
      phase: form.phase || "Tasks",
      name: form.name,
      notes: form.notes,
      responsibleRole: form.responsibleRole,
      assigneeId: null,
      estimatedHours: null,
      startDate: null,
      dueDate: null,
      status: "Not Started",
      blockedBy: [],
      order: tasks.length + 1,
    });
    setAddingTask(false);
  };

  const submitBaseline = async () => {
    await updateDoc(doc(db, "projects", id), {
      baselineStatus: "Pending Approval",
      proposedBaselineEndDate: proposedBaseline,
    });
  };

  const approveBaseline = async () => {
    await updateDoc(doc(db, "projects", id), {
      baselineStatus: "Locked",
      baselineEndDate: project.proposedBaselineEndDate,
      baselineRejectionComment: null,
    });
  };

  const rejectBaseline = async () => {
    await updateDoc(doc(db, "projects", id), {
      baselineStatus: "Rejected",
      baselineRejectionComment: rejectComment,
    });
    setShowReject(false);
    setRejectComment("");
  };

  if (!project) {
    return <p className="text-[13px] text-gray-400">Loading project...</p>;
  }

  let currentPhase = "";

  return (
    <div>
      <Link to="/projects" className="text-[11px] text-navy underline">
        ← Back to Projects
      </Link>
      <div className="flex items-start justify-between mt-2 mb-0.5">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold font-heading text-navy">{project.name}</h2>
            <span className="text-[11px] text-gray-400 font-mono">{project.projectCode}</span>
            <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[11px] font-medium">
              {project.priority}
            </span>
          </div>
          <p className="text-xs text-gray-500">{project.description}</p>
        </div>
        {project.folderUrl && (
          <a
            href={project.folderUrl}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-teal-700 underline whitespace-nowrap"
          >
            Project Folder ↗
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4 text-[13px]">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Owner</div>
          <div className="font-medium text-navy mt-1">{nameFor(project.ownerId)}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Approver</div>
          <div className="font-medium text-navy mt-1">{nameFor(project.approverId)}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Work Type</div>
          <div className="font-medium text-navy mt-1">{project.workTypeName}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Delivery Format</div>
          <div className="font-medium text-navy mt-1">{project.deliveryFormat || "—"}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Training Type</div>
          <div className="font-medium text-navy mt-1">{project.trainingType || "—"}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Development Type</div>
          <div className="font-medium text-navy mt-1">{project.developmentType || "—"}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Source</div>
          <div className="font-medium text-navy mt-1">
            {project.source}
            {project.source === "Intake Request" && (
              <div className="text-[11px] text-gray-400 font-normal">
                {project.requestorName} — {project.requestorDepartment}
              </div>
            )}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Actual Completion</div>
          <div className="font-medium text-navy mt-1">{project.actualCompletionDate || "—"}</div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1">
              Baseline Deadline — {project.baselineStatus}
            </div>
            {project.baselineStatus === "Locked" ? (
              <div className="text-[13px] font-semibold text-navy">
                {project.baselineEndDate} (locked)
              </div>
            ) : project.baselineStatus === "Pending Approval" ? (
              <div className="text-[13px] text-amber-700">
                Awaiting approval — proposed date {project.proposedBaselineEndDate}
              </div>
            ) : project.baselineStatus === "Rejected" ? (
              <div className="text-[13px] text-red-600">
                Rejected: {project.baselineRejectionComment}
              </div>
            ) : (
              <div className="text-[13px] text-gray-500">
                {proposedBaseline
                  ? `Ready to submit — computed end date ${proposedBaseline}`
                  : "Add hours to tasks below to compute a proposed end date"}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isOwner &&
              (project.baselineStatus === "Not Submitted" || project.baselineStatus === "Rejected") &&
              proposedBaseline && (
                <button
                  onClick={submitBaseline}
                  className="text-[11px] bg-navy text-white px-3 py-1.5 rounded-md"
                >
                  Submit Baseline for Approval
                </button>
              )}
            {isApprover && project.baselineStatus === "Pending Approval" && !showReject && (
              <>
                <button
                  onClick={approveBaseline}
                  className="text-[11px] bg-teal text-navy font-medium px-3 py-1.5 rounded-md"
                >
                  Approve
                </button>
                <button
                  onClick={() => setShowReject(true)}
                  className="text-[11px] border border-gray-300 px-3 py-1.5 rounded-md text-gray-600"
                >
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
        {showReject && (
          <div className="mt-3 flex gap-2">
            <input
              placeholder="Reason for rejection"
              value={rejectComment}
              onChange={(e) => setRejectComment(e.target.value)}
              className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-[11px]"
            />
            <button
              onClick={rejectBaseline}
              className="text-[11px] bg-red-500 text-white px-3 py-1.5 rounded-md"
            >
              Confirm Reject
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-navy font-heading">
            Task List — {project.workTypeName}
          </h3>
          <button
            onClick={() => setAddingTask(true)}
            className="text-[11px] text-navy underline"
          >
            + Add Task
          </button>
        </div>
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-left text-[10px] text-gray-400 uppercase tracking-wide font-medium">
            <tr>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Assignee</th>
              <th className="px-3 py-2">Est. Hours</th>
              <th className="px-3 py-2">Dates</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {addingTask && (
              <AddTaskRow onCancel={() => setAddingTask(false)} onAdd={addManualTask} />
            )}
            {tasks.map((t) => {
              const showPhase = t.phase !== currentPhase;
              currentPhase = t.phase;
              return (
                <Fragment key={t.id}>
                  {showPhase && (
                    <tr>
                      <td colSpan={7} className="px-3 py-2 bg-slate-50/70 text-[11px] font-semibold text-navy uppercase">
                        {t.phase}
                      </td>
                    </tr>
                  )}
                  {editingId === t.id ? (
                    <EditTaskRow
                      task={t}
                      members={members}
                      onCancel={() => setEditingId(null)}
                      onSaved={(changes) => saveTask(t.id, changes)}
                    />
                  ) : (
                    <tr className="border-t border-gray-100 hover:bg-slate-50/50">
                      <td className="px-3 py-2">
                        <div className="text-navy">{t.name}</div>
                        <div className="text-[11px] text-gray-400">{t.notes}</div>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{t.responsibleRole}</td>
                      <td className="px-3 py-2 text-gray-600">
                        {t.assigneeId ? nameFor(t.assigneeId) : "—"}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {t.estimatedHours ? `${t.estimatedHours}h` : "—"}
                      </td>
                      <td className="px-3 py-2 text-gray-600 text-[11px]">
                        {t.startDate && t.dueDate ? `${t.startDate} → ${t.dueDate}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[11px] font-medium">
                          {t.status}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setEditingId(t.id)}
                          className="text-[11px] text-navy underline"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {tasks.length === 0 && !addingTask && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-gray-400">
                  No tasks yet. Click "+ Add Task" to start building the list.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
