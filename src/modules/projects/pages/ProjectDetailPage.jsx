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
import { computeRollups } from "../../../lib/completion";
import { useAuth } from "../../../context/AuthContext";
import { phaseColor, STATUS_PILL_STYLES } from "../../../lib/taskColors";

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

function TaskRow({ task, depth, members, childrenByParent, completionByTaskId, onCommit, onAddSubtask, expanded, onToggleExpand }) {
  const children = childrenByParent[task.id] || [];
  const hasChildren = children.length > 0;

  return (
    <>
      <tr className="border-t border-gray-100 hover:bg-slate-50/50 align-top">
        <td className="px-3 py-1.5" style={{ paddingLeft: `${12 + depth * 20}px` }}>
          <div className="flex items-start gap-1.5">
            {hasChildren && (
              <button onClick={() => onToggleExpand(task.id)} className="text-gray-400 text-[10px] mt-0.5">
                {expanded ? "▾" : "▸"}
              </button>
            )}
            <div className="flex-1">
              <div className="text-navy">{task.name}</div>
              <div className="flex items-center gap-2 mt-0.5">
                {hasChildren && <ProgressBar pct={completionByTaskId[task.id] || 0} />}
                <button onClick={() => onAddSubtask(task)} className="text-[10px] text-teal-700">
                  + subtask
                </button>
              </div>
            </div>
          </div>
        </td>
        <td className="px-3 py-1.5">
          <select
            value={task.assigneeId || ""}
            onChange={(e) => onCommit(task, { assigneeId: e.target.value || null })}
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
            defaultValue={task.estimatedHours || ""}
            onBlur={(e) => onCommit(task, { estimatedHours: e.target.value ? Number(e.target.value) : null })}
            placeholder="—"
            className="w-16 border border-transparent hover:border-gray-200 rounded-md px-1.5 py-1 text-[11px] bg-transparent focus:bg-white focus:border-gray-300"
          />
        </td>
        <td className="px-3 py-1.5">
          <input
            type="number"
            min="0"
            step="0.5"
            defaultValue={task.actualHours || ""}
            onBlur={(e) => onCommit(task, { actualHours: e.target.value ? Number(e.target.value) : null })}
            placeholder="—"
            className="w-16 border border-transparent hover:border-gray-200 rounded-md px-1.5 py-1 text-[11px] bg-transparent focus:bg-white focus:border-gray-300"
          />
        </td>
        <td className="px-3 py-1.5 text-gray-500 text-[11px]">
          {depth === 0 ? task.startDate || "—" : "—"}
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
          <select
            value={task.status}
            onChange={(e) => onCommit(task, { status: e.target.value })}
            className={`appearance-none cursor-pointer rounded-full px-2.5 py-1 text-[11px] font-medium border-none focus:outline-none focus:ring-2 focus:ring-teal ${STATUS_PILL_STYLES[task.status] || STATUS_PILL_STYLES["Not Started"]}`}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
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
            expanded={true}
            onToggleExpand={onToggleExpand}
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
  const [expandedTasks, setExpandedTasks] = useState({});
  const [rejectComment, setRejectComment] = useState("");
  const [showReject, setShowReject] = useState(false);

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

  const topLevelTasks = tasks.filter((t) => !t.parentTaskId);
  const { completionByTaskId, phaseCompletion, projectCompletion, childrenByParent } = computeRollups(tasks);

  const scheduledDueDates = topLevelTasks.filter((t) => t.dueDate).map((t) => t.dueDate);
  const proposedBaseline = scheduledDueDates.length ? scheduledDueDates.sort().at(-1) : null;

  const commitTopLevelChange = async (taskId, changes) => {
    const updated = topLevelTasks.map((t) => (t.id === taskId ? { ...t, ...changes } : t));
    const scheduled = computeSchedule(updated, project.startDate);
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

  const commitTask = async (task, changes) => {
    if (!task.parentTaskId) {
      await commitTopLevelChange(task.id, changes);
    } else {
      await updateDoc(doc(db, "projects", id, "tasks", task.id), changes);
    }
  };

  const addManualTask = async (name) => {
    await addDoc(collection(db, "projects", id, "tasks"), {
      parentTaskId: null,
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
      order: tasks.length + 1,
    });
    setAddingTask(false);
  };

  const addSubtask = async (parentTask) => {
    const name = window.prompt("Subtask name");
    if (!name || !name.trim()) return;
    await addDoc(collection(db, "projects", id, "tasks"), {
      parentTaskId: parentTask.id,
      phase: parentTask.phase,
      name: name.trim(),
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
      order: Date.now(),
    });
    setExpandedTasks((p) => ({ ...p, [parentTask.id]: true }));
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
  topLevelTasks.forEach((t) => {
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
        <div className="flex items-center gap-3">
          <ProgressBar pct={projectCompletion} />
          {project.folderUrl && (
            <a href={project.folderUrl} target="_blank" rel="noreferrer" className="text-[11px] text-teal-700 underline whitespace-nowrap">
              Project Folder ↗
            </a>
          )}
        </div>
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
              const phaseTasks = topLevelTasks.filter((t) => t.phase === phase);
              const collapsed = collapsedPhases[phase];
              return (
                <Fragment key={phase}>
                  <tr onClick={() => setCollapsedPhases((p) => ({ ...p, [phase]: !p[phase] }))} className={`cursor-pointer border-l-2 ${phaseColor(phaseIdx)}`}>
                    <td colSpan={8} className="px-3 py-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-semibold uppercase">
                          {collapsed ? "▸" : "▾"} {phase}{" "}
                          <span className="font-normal normal-case text-[10px] opacity-70">
                            ({phaseTasks.length} task{phaseTasks.length !== 1 ? "s" : ""})
                          </span>
                        </span>
                        <ProgressBar pct={phaseCompletion[phase] || 0} />
                      </div>
                    </td>
                  </tr>
                  {!collapsed &&
                    phaseTasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        depth={0}
                        members={members}
                        childrenByParent={childrenByParent}
                        completionByTaskId={completionByTaskId}
                        onCommit={commitTask}
                        onAddSubtask={addSubtask}
                        expanded={!!expandedTasks[t.id]}
                        onToggleExpand={(taskId) => setExpandedTasks((p) => ({ ...p, [taskId]: !p[taskId] }))}
                      />
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
