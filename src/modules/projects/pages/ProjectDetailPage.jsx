import { useEffect, useState, Fragment } from "react";
import { useParams, Link } from "react-router-dom";
import { doc, onSnapshot, collection, query, orderBy } from "firebase/firestore";
import { db } from "../../../lib/firebase";

export default function ProjectDetailPage() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [users, setUsers] = useState([]);

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
          <h2 className="text-2xl font-bold font-heading text-navy">{project.name}</h2>
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 my-6">
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="text-xs text-gray-400 uppercase">Owner</div>
          <div className="text-sm font-medium text-navy mt-1">{nameFor(project.ownerId)}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="text-xs text-gray-400 uppercase">Baseline End</div>
          <div className="text-sm font-medium text-navy mt-1">{project.baselineEndDate}</div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="text-xs text-gray-400 uppercase">Approved Revised End</div>
          <div className="text-sm font-medium text-navy mt-1">
            {project.approvedRevisedEndDate || "—"}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
          <div className="text-xs text-gray-400 uppercase">Actual Completion</div>
          <div className="text-sm font-medium text-navy mt-1">
            {project.actualCompletionDate || "—"}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-navy font-heading">
            Task List — {project.templateName}
          </h3>
          <span className="text-xs text-gray-400">
            Hours + auto-scheduled dates come in the Tasks module next
          </span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs text-gray-400 uppercase">
            <tr>
              <th className="px-4 py-2">Task</th>
              <th className="px-4 py-2">Responsible Role</th>
              <th className="px-4 py-2">Est. Days</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => {
              const showPhase = t.phase !== currentPhase;
              currentPhase = t.phase;
              return (
                <Fragment key={t.id}>
                  {showPhase && (
                    <tr key={t.phase} className="bg-slate-50/70">
                      <td colSpan={4} className="px-4 py-2 text-xs font-semibold text-navy uppercase">
                        {t.phase}
                      </td>
                    </tr>
                  )}
                  <tr key={t.id} className="border-t border-gray-100">
                    <td className="px-4 py-2">
                      <div className="text-navy">{t.name}</div>
                      <div className="text-xs text-gray-400">{t.notes}</div>
                    </td>
                    <td className="px-4 py-2 text-gray-600">{t.responsibleRole}</td>
                    <td className="px-4 py-2 text-gray-600">{t.estimatedDays}</td>
                    <td className="px-4 py-2">
                      <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded text-xs font-medium">
                        {t.status}
                      </span>
                    </td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
