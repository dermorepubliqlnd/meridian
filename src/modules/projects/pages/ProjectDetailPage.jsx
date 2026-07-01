import { useEffect, useState, Fragment } from "react";
import { useParams, Link } from "react-router-dom";
import {
  doc,
  onSnapshot,
  collection,
  query,
  orderBy,
  writeBatch,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { computeSchedule } from "../../../lib/scheduling";

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
      <td className="px-3 py-1.5">
        <div className="text-navy">{task.name}</div>
        <div className="text-xs text-gray-400">{task.notes}</div>
      </td>
      <td className="px-3 py-1.5 text-gray-600">{task.responsibleRole}</td>
      <td className="px-3 py-1.5">
        <select
          value={edit.assigneeId}
          onChange={(e) => setEdit({ ...edit, assigneeId: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs"
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
          value={edit.estimatedHours}
          onChange={(e) => setEdit({ ...edit, estimatedHours: e.target.value })}
          placeholder="hrs"
          className="w-20 border border-gray-300 rounded-md px-2 py-1 text-xs"
        />
      </td>
      <td className="px-3 py-1.5 text-xs text-gray-400">auto</td>
      <td className="px-3 py-1.5">
        <select
          value={edit.status}
          onChange={(e) => setEdit({ ...edit, status: e.target.value })}
          className="w-full border border-gray-300 rounded-md px-2 py-1 text-xs"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-1.5 whitespace-nowrap">
        <button
          onClick={save}
          disabled={saving}
          className="text-xs bg-navy text-white px-2 py-1 rounded-md mr-2 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500">
          Cancel
        </button>
      </td>
    </tr>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);
  const [editingId, setEditingId] = useState(null);

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

  if (!project) {
    return <p className="text-sm text-gray-400">Loading project...</p>;
  }

  let currentPhase = "";

  return (
    <div>
      <Link to="/projects" className="text-xs text-navy underline">
        ← Back to Projects
      </Link>
      <div className="flex items-start justify-between mt-2 mb-1">
        <div>
          <h2 className="text-xl font-bold font-heading text-navy">{project.name}</h2>
          <p className="text-sm text-gray-500">{project.description}</p>
        </div>
        {project.folderUrl && (
          <a
            href={project.folderUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-teal-700 underline whitespace-nowrap"
          >
            Project Folder ↗
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-4">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Owner</div>
          <div className="text-sm font-medium text-navy mt-1">{nameFor(project.ownerId)}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Baseline End</div>
          <div className="text-sm font-medium text-navy mt-1">{project.baselineEndDate}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Approved Revised End</div>
          <div className="text-sm font-medium text-navy mt-1">
            {project.approvedRevisedEndDate || "—"}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium">Actual Completion</div>
          <div className="text-sm font-medium text-navy mt-1">
            {project.actualCompletionDate || "—"}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-navy font-heading">
            Task List — {project.templateName}
          </h3>
          <span className="text-xs text-gray-400">
            Dates auto-calculate from hours (8 hrs/day, weekdays only — holiday/time-off
            awareness comes with People &amp; Resources)
          </span>
        </div>
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-left text-[10px] text-gray-400 uppercase tracking-wide font-medium">
            <tr>
              <th className="px-3 py-1.5">Task</th>
              <th className="px-3 py-1.5">Role</th>
              <th className="px-3 py-1.5">Assignee</th>
              <th className="px-3 py-1.5">Est. Hours</th>
              <th className="px-3 py-1.5">Dates</th>
              <th className="px-3 py-1.5">Status</th>
              <th className="px-3 py-1.5"></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const showPhase = t.phase !== currentPhase;
              currentPhase = t.phase;
              return (
                <Fragment key={t.id}>
                  {showPhase && (
                    <tr>
                      <td colSpan={7} className="px-3 py-1.5 bg-slate-50/70 text-xs font-semibold text-navy uppercase">
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
                      <td className="px-3 py-1.5">
                        <div className="text-navy">{t.name}</div>
                        <div className="text-xs text-gray-400">{t.notes}</div>
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">{t.responsibleRole}</td>
                      <td className="px-3 py-1.5 text-gray-600">
                        {t.assigneeId ? nameFor(t.assigneeId) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-gray-600">
                        {t.estimatedHours ? `${t.estimatedHours}h` : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-gray-600 text-xs">
                        {t.startDate && t.dueDate ? `${t.startDate} → ${t.dueDate}` : "—"}
                      </td>
                      <td className="px-3 py-1.5">
                        <span className="bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[11px] font-medium">
                          {t.status}
                        </span>
                      </td>
                      <td className="px-3 py-1.5">
                        <button
                          onClick={() => setEditingId(t.id)}
                          className="text-xs text-navy underline"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
