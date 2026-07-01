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
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { computeSchedule } from "../../../lib/scheduling";
import { useAuth } from "../../../context/AuthContext";
import { phaseColor, STATUS_STYLES } from "../../../lib/taskColors";

const STATUSES = ["Not Started", "In Progress", "Blocked", "Done"];

function StatusBadge({ status }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded text-[11px] font-medium border-l-2 ${STATUS_STYLES[status] || STATUS_STYLES["Not Started"]}`}
    >
      {status}
    </span>
  );
}

function SubtaskList({ subtasks, onToggle, onAdd, onRemove }) {
  const [newSubtask, setNewSubtask] = useState("");
  return (
    <div className="pl-6 pr-3 py-2 bg-slate-50/60">
      {subtasks.map((s) => (
        <div key={s.id} className="flex items-center gap-2 py-0.5 text-[12px]">
          <input type="checkbox" checked={s.done} onChange={() => onToggle(s.id)} />
          <span className={s.done ? "line-through text-gray-400" : "text-gray-700"}>{s.name}</span>
          <button onClick={() => onRemove(s.id)} className="text-gray-300 hover:text-red-400 ml-auto text-[11px]">
            remove
          </button>
        </div>
      ))}
      <div className="flex gap-2 mt-1">
        <input
          value={newSubtask}
          onChange={(e) => setNewSubtask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newSubtask.trim()) {
              onAdd(newSubtask.trim());
              setNewSubtask("");
            }
          }}
          placeholder="Add subtask, press Enter"
          className="flex-1 border border-gray-200 rounded-md px-2 py-1 text-[11px] bg-white"
        />
      </div>
    </div>
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
      <td className="px-3 py-2" colSpan={7}>
        <div className="flex gap-2">
          <input
            autoFocus
            placeholder="New task name..."
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-[12px]"
          />
          <button onClick={save} disabled={saving} className="text-[11px] bg-navy text-white px-3 py-1 rounded-md">
            {saving ? "Adding..." : "Add"}
          </button>
          <button onClick={onCancel} className="text-[11px] text-gray-500 px-2">
            Cancel
          </button>
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
  const [expandedSubtasks, setExpandedSubtasks] = useState({});
  const [rejectComment, setRejectComment] = useState("");
  const [showReject, setShowReject] = useState(false);

  useEffect(() => {
    const unsubProject = onSnapshot(doc(db, "projects", id), (snap) => {
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    const unsubTasks = onSnapshot(
      query(collection(db, "projects", id, "tasks"), orderBy("order")),
      (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, subtasks: [], ...d.data() })))
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
  const proposedBaseline = scheduledDueDates.length ? scheduledDueDates.sort().at(-1) : null;

  const commitTaskChange = async (taskId, changes) => {
    const updatedTasks = tasks.map((t) => (t.id === taskId ? { ...t, ...changes } : t));
    const scheduled = computeSchedule(updatedTasks, project.startDate);

    const batch = writeBatch(db);
    scheduled.forEach((t) => {
      batch.update(doc(db, "projects", id, "tasks", t.id), {
        assigneeId: t.assigneeId ?? null,
        estimatedHours: t.estimatedHours ?? null,
        actualHours: t.actualHours ?? null,
        status: t.status,
        actualCompletionDate: t.actualCompletionDate ?? null,
        startDate: t.startDate,
        dueDate: t.dueDate,
      });
    });
    await batch.commit();
  };

  const addManualTask = async (name) => {
    await addDoc(collection(db, "projects", id, "tasks"), {
      phase: "Additional Tasks",
      name,
      notes: "",
      responsibleRole: "",
      assigneeId: null,
      estimatedHours: null,
      actualHours: null,
      startDate: null,
      dueDate: null,
      actualCompletionDate: null,
      status: "Not Started",
      blockedBy: [],
      subtasks: [],
      order: tasks.length + 1,
    });
    setAddingTask(false);
  };

  const toggleSubtask = async (task, subtaskId) => {
    const updated = task.subtasks.map((s) => (s.id === subtaskId ? { ...s, done: !s.done } : s));
    await updateDoc(doc(db, "projects", id, "tasks", task.id), { subtasks: updated });
  };

  const addSubtask = async (task, name) => {
    const updated = [...task.subtasks, { id: `${Date.now()}`, name, done: false }];
    await updateDoc(doc(db, "projects", id, "tasks", task.id), { subtasks: updated });
  };

  const removeSubtask = async (task, subtaskId) => {
    const updated = task.subtasks.filter((s) => s.id !== subtaskId);
    await updateDoc(doc(db, "projects", id, "tasks", task.id), { subtasks: updated });
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

  const phaseOrder = [];
  tasks.forEach((t) => {
    if (!phaseOrder.includes(t.phase)) phaseOrder.push(t.phase);
  });

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
            <span className="bg-violet-50 border-l-2 border-violet-300 text-violet-700 px-1.5 py-0.5 rounded text-[11px] font-medium">
              {project.priority}
            </span>
          </div>
          <p className="text-xs text-gray-500">{project.description}</p>
        </div>
        {project.folderUrl && (
          <a href={project.folderUrl} target="_blank" rel="noreferrer" className="text-[11px] text-teal-700 underline whitespace-nowrap">
            Project Folder ↗
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4 text-[13px]">
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
              <div className="text-[11px] text-gray-400 font-normal">
                {project.requestorName} — {project.requestorDepartment}
              </div>
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
            <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1">
              Baseline Deadline — {project.baselineStatus}
            </div>
            {project.baselineStatus === "Locked" ? (
              <div className="text-[13px] font-semibold text-navy">{project.baselineEndDate} (locked)</div>
            ) : project.baselineStatus === "Pending Approval" ? (
              <div className="text-[13px] text-amber-700">Awaiting approval — proposed date {project.proposedBaselineEndDate}</div>
            ) : project.baselineStatus === "Rejected" ? (
              <div className="text-[13px] text-red-600">Rejected: {project.baselineRejectionComment}</div>
            ) : (
              <div className="text-[13px] text-gray-500">
                {proposedBaseline ? `Ready to submit — computed end date ${proposedBaseline}` : "Add hours to tasks below to compute a proposed end date"}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isOwner && (project.baselineStatus === "Not Submitted" || project.baselineStatus === "Rejected") && proposedBaseline && (
              <button onClick={submitBaseline} className="text-[11px] bg-navy text-white px-3 py-1.5 rounded-md">
                Submit Baseline for Approval
              </button>
            )}
            {isApprover && project.baselineStatus === "Pending Approval" && !showReject && (
              <>
                <button onClick={approveBaseline} className="text-[11px] bg-teal text-navy font-medium px-3 py-1.5 rounded-md">
                  Approve
                </button>
                <button onClick={() => setShowReject(true)} className="text-[11px] border border-gray-300 px-3 py-1.5 rounded-md text-gray-600">
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
        {showReject && (
          <div className="mt-3 flex gap-2">
            <input placeholder="Reason for rejection" value={rejectComment} onChange={(e) => setRejectComment(e.target.value)} className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-[11px]" />
            <button onClick={rejectBaseline} className="text-[11px] bg-red-500 text-white px-3 py-1.5 rounded-md">
              Confirm Reject
            </button>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-navy font-heading">Task List — {project.workTypeName}</h3>
          <button onClick={() => setAddingTask(true)} className="text-[11px] text-navy underline">
            + Add Task
          </button>
        </div>
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
              const phaseTasks = tasks.filter((t) => t.phase === phase);
              const collapsed = collapsedPhases[phase];
              return (
                <Fragment key={phase}>
                  <tr
                    onClick={() => setCollapsedPhases((p) => ({ ...p, [phase]: !p[phase] }))}
                    className={`cursor-pointer border-l-2 ${phaseColor(phaseIdx)}`}
                  >
                    <td colSpan={8} className="px-3 py-1.5 text-[11px] font-semibold uppercase">
                      {collapsed ? "▸" : "▾"} {phase}{" "}
                      <span className="font-normal normal-case text-[10px] opacity-70">
                        ({phaseTasks.length} task{phaseTasks.length !== 1 ? "s" : ""})
                      </span>
                    </td>
                  </tr>
                  {!collapsed &&
                    phaseTasks.map((t) => (
                      <Fragment key={t.id}>
                        <tr className="border-t border-gray-100 hover:bg-slate-50/50 align-top">
                          <td className="px-3 py-1.5">
                            <div className="text-navy">{t.name}</div>
                            <button
                              onClick={() => setExpandedSubtasks((p) => ({ ...p, [t.id]: !p[t.id] }))}
                              className="text-[10px] text-teal-700 mt-0.5"
                            >
                              {t.subtasks?.length ? `${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length} subtasks` : "+ subtasks"}
                            </button>
                          </td>
                          <td className="px-3 py-1.5">
                            <select
                              value={t.assigneeId || ""}
                              onChange={(e) => commitTaskChange(t.id, { assigneeId: e.target.value || null })}
                              className="w-full border border-transparent hover:border-gray-200 rounded-md px-1.5 py-1 text-[11px] bg-transparent focus:bg-white focus:border-gray-300"
                            >
                              <option value="">Unassigned</option>
                              {members.map((m) => (
                                <option key={m.id} value={m.id}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              defaultValue={t.estimatedHours || ""}
                              onBlur={(e) => commitTaskChange(t.id, { estimatedHours: e.target.value ? Number(e.target.value) : null })}
                              placeholder="—"
                              className="w-16 border border-transparent hover:border-gray-200 rounded-md px-1.5 py-1 text-[11px] bg-transparent focus:bg-white focus:border-gray-300"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <input
                              type="number"
                              min="0"
                              step="0.5"
                              defaultValue={t.actualHours || ""}
                              onBlur={(e) => commitTaskChange(t.id, { actualHours: e.target.value ? Number(e.target.value) : null })}
                              placeholder="—"
                              className="w-16 border border-transparent hover:border-gray-200 rounded-md px-1.5 py-1 text-[11px] bg-transparent focus:bg-white focus:border-gray-300"
                            />
                          </td>
                          <td className="px-3 py-1.5 text-gray-500 text-[11px]">{t.startDate || "—"}</td>
                          <td className="px-3 py-1.5 text-gray-500 text-[11px]">{t.dueDate || "—"}</td>
                          <td className="px-3 py-1.5">
                            <input
                              type="date"
                              defaultValue={t.actualCompletionDate || ""}
                              onChange={(e) => commitTaskChange(t.id, { actualCompletionDate: e.target.value || null })}
                              className="border border-transparent hover:border-gray-200 rounded-md px-1.5 py-1 text-[11px] bg-transparent focus:bg-white focus:border-gray-300"
                            />
                          </td>
                          <td className="px-3 py-1.5">
                            <select
                              value={t.status}
                              onChange={(e) => commitTaskChange(t.id, { status: e.target.value })}
                              className="border-none bg-transparent text-[11px]"
                            >
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {s}
                                </option>
                              ))}
                            </select>
                            <div className="mt-0.5">
                              <StatusBadge status={t.status} />
                            </div>
                          </td>
                        </tr>
                        {expandedSubtasks[t.id] && (
                          <tr>
                            <td colSpan={8} className="p-0">
                              <SubtaskList
                                subtasks={t.subtasks || []}
                                onToggle={(sid) => toggleSubtask(t, sid)}
                                onAdd={(name) => addSubtask(t, name)}
                                onRemove={(sid) => removeSubtask(t, sid)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                </Fragment>
              );
            })}
            {tasks.length === 0 && !addingTask && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-400">
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
