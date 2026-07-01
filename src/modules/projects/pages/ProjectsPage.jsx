import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, collectionGroup, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { computeHealth } from "../../../lib/health";
import { computeRollups } from "../../../lib/completion";

export default function ProjectsPage() {
  const { user, profile } = useAuth();
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [tasksByProject, setTasksByProject] = useState({});

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const projRef = collection(db, "projects");
    const q =
      profile?.role === "Admin"
        ? projRef
        : query(projRef, where("memberIds", "array-contains", user.uid));

    const unsubProjects = onSnapshot(q, (snap) => {
      setProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const unsubTasks = onSnapshot(collectionGroup(db, "tasks"), (snap) => {
      const grouped = {};
      snap.docs.forEach((d) => {
        const projectId = d.ref.parent.parent.id;
        (grouped[projectId] ||= []).push({ id: d.id, parentTaskId: null, ...d.data() });
      });
      setTasksByProject(grouped);
    });

    return () => {
      unsubUsers();
      unsubProjects();
      unsubTasks();
    };
  }, [user, profile]);

  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold font-heading text-navy">Projects</h2>
        <Link
          to="/projects/new"
          className="bg-navy text-white text-sm font-medium px-3 py-1.5 rounded-md hover:bg-navy-light transition"
        >
          + New Project
        </Link>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        WBS templates, 3-date deadline system, invite-only visibility.
      </p>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-left text-[10px] text-gray-400 uppercase tracking-wide font-medium">
            <tr>
              <th className="px-3 py-2">Project</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Priority</th>
              <th className="px-3 py-2">Baseline</th>
              <th className="px-3 py-2">Completion</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Health</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => {
              const { projectCompletion } = computeRollups(tasksByProject[p.id] || []);
              const health = computeHealth(p, projectCompletion);
              return (
                <tr key={p.id} className="border-t border-gray-100 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link to={`/projects/${p.id}`} className="text-navy font-medium hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-xs text-gray-400">{p.workTypeName}</div>
                  </td>
                  <td className="px-3 py-2 text-gray-600">{nameFor(p.ownerId)}</td>
                  <td className="px-3 py-2 text-gray-600">{p.priority}</td>
                  <td className="px-3 py-2 text-gray-600 text-[11px]">
                    {p.approvedRevisedEndDate || p.baselineEndDate || "—"}
                    {p.approvedRevisedEndDate && <span className="text-amber-600 ml-1">(revised)</span>}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{Math.round(projectCompletion)}%</td>
                  <td className="px-3 py-2 text-gray-500 text-[11px]">{p.status || "Planning"}</td>
                  <td className="px-3 py-2">
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${health.style}`}>{health.label}</span>
                  </td>
                </tr>
              );
            })}
            {projects.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  No projects yet. Click "+ New Project" to create one from a WBS template.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
