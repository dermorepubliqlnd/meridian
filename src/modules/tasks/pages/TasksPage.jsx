import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collectionGroup, collection, onSnapshot } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { STATUS_STYLES } from "../../../lib/taskColors";

export default function TasksPage() {
  const { user, profile } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [projects, setProjects] = useState({});
  const [users, setUsers] = useState([]);
  const [assigneeFilter, setAssigneeFilter] = useState("all");

  useEffect(() => {
    const unsubTasks = onSnapshot(collectionGroup(db, "tasks"), (snap) => {
      setTasks(
        snap.docs.map((d) => ({
          id: d.id,
          projectId: d.ref.parent.parent.id,
          ...d.data(),
        }))
      );
    });
    const unsubProjects = onSnapshot(collection(db, "projects"), (snap) => {
      const map = {};
      snap.docs.forEach((d) => (map[d.id] = { id: d.id, ...d.data() }));
      setProjects(map);
    });
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => {
      unsubTasks();
      unsubProjects();
      unsubUsers();
    };
  }, []);

  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";

  // Invite-only: only show tasks that belong to projects the user can see.
  const visibleTasks = tasks.filter((t) => {
    const p = projects[t.projectId];
    if (!p) return false;
    if (profile?.role === "Admin") return true;
    return p.memberIds?.includes(user.uid);
  });

  const filteredTasks =
    assigneeFilter === "all"
      ? visibleTasks
      : assigneeFilter === "unassigned"
      ? visibleTasks.filter((t) => !t.assigneeId)
      : visibleTasks.filter((t) => t.assigneeId === assigneeFilter);

  const sorted = [...filteredTasks].sort((a, b) => {
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold font-heading text-navy">Tasks</h2>
        <select
          value={assigneeFilter}
          onChange={(e) => setAssigneeFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
        >
          <option value="all">All assignees</option>
          <option value="unassigned">Unassigned</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Every task across every project you have access to, sorted by due date. Edit hours,
        assignee, and status from inside each project's task list.
      </p>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-left text-[10px] text-gray-400 uppercase tracking-wide font-medium">
            <tr>
              <th className="px-3 py-2">Task</th>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2">Assignee</th>
              <th className="px-3 py-2">Dates</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={`${t.projectId}-${t.id}`} className="border-t border-gray-100 hover:bg-slate-50/50">
                <td className="px-3 py-2">
                  <div className="text-navy">{t.name}</div>
                  <div className="text-xs text-gray-400">{t.phase}</div>
                </td>
                <td className="px-3 py-2">
                  <Link to={`/projects/${t.projectId}`} className="text-teal-700 underline">
                    {projects[t.projectId]?.name || "—"}
                  </Link>
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {t.assigneeId ? nameFor(t.assigneeId) : "—"}
                </td>
                <td className="px-3 py-2 text-gray-600 text-xs">
                  {t.startDate && t.dueDate ? `${t.startDate} → ${t.dueDate}` : "—"}
                </td>
                <td className="px-3 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium border-l-2 ${STATUS_STYLES[t.status] || STATUS_STYLES["Not Started"]}`}>{t.status}</span>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                  No tasks to show yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
