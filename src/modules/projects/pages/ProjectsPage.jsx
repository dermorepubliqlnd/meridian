import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, collectionGroup, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { computeHealth, STATUS_STYLES, PHASE_STYLES, PROJECT_STATUSES, PROJECT_PHASES, migrateLegacyStatus } from "../../../lib/health";
import { computeRollups } from "../../../lib/completion";

const STORAGE_KEY = "meridian.projectsTable.v1";

const COLUMN_DEFS = [
  { key: "projectCode", label: "Code", width: 90 },
  { key: "name", label: "Project Name", width: 220 },
  { key: "description", label: "Description", width: 240 },
  { key: "source", label: "Source", width: 130 },
  { key: "requestorDepartment", label: "Requestor Dept.", width: 140 },
  { key: "ticketNumber", label: "Ticket #", width: 110 },
  { key: "priority", label: "Priority", width: 100 },
  { key: "startDate", label: "Start Date", width: 110 },
  { key: "workTypeName", label: "Work Type", width: 170 },
  { key: "trainingType", label: "Training Type", width: 140 },
  { key: "deliveryFormat", label: "Delivery Format", width: 140 },
  { key: "developmentType", label: "Effort Level", width: 130 },
  { key: "ownerId", label: "Owner", width: 140 },
  { key: "approverId", label: "Approver", width: 140 },
  { key: "baselineStatus", label: "Baseline Status", width: 140 },
  { key: "baselineEndDate", label: "Baseline End Date", width: 140 },
  { key: "approvedRevisedEndDate", label: "Approved Revised End", width: 160 },
  { key: "actualCompletionDate", label: "Actual Completion", width: 140 },
  { key: "completion", label: "Completion %", width: 110 },
  { key: "status", label: "Status", width: 120 },
  { key: "health", label: "Health", width: 160 },
  { key: "folderUrl", label: "Folder", width: 90 },
];

const DEFAULT_VISIBLE = new Set([
  "name",
  "ownerId",
  "priority",
  "status",
  "health",
  "completion",
  "baselineEndDate",
  "startDate",
  "workTypeName",
]);

const PRIORITY_RANK = { Low: 0, Medium: 1, High: 2 };

// ── Color maps ──────────────────────────────────────────────────────────────
const PRIORITY_PILL = {
  High:   "bg-red-50 text-red-700 border border-red-200",
  Medium: "bg-yellow-50 text-yellow-700 border border-yellow-200",
  Low:    "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

const EFFORT_PILL = {
  "Level 1": "bg-emerald-100 text-emerald-700",
  "Level 2": "bg-amber-100 text-amber-700",
  "Level 3": "bg-red-100 text-red-700",
};

// Status + Phase pills come from health.js STATUS_STYLES / PHASE_STYLES

// Group header accent colors keyed by status/phase/health label
const GROUP_HEADER_ACCENT = {
  // Status (lifecycle)
  "Not Started": "border-l-4 border-gray-300 bg-gray-50",
  "Active":      "border-l-4 border-blue-400 bg-blue-50/60",
  "On Hold":     "border-l-4 border-amber-400 bg-amber-50/60",
  "Done":        "border-l-4 border-emerald-400 bg-emerald-50/60",
  "Canceled":    "border-l-4 border-red-300 bg-red-50/60",
  // Phase (ADDIE)
  "Scoping":        "border-l-4 border-slate-400 bg-slate-50",
  "Planning":       "border-l-4 border-yellow-400 bg-yellow-50/60",
  "Design":         "border-l-4 border-purple-400 bg-purple-50/60",
  "Development":    "border-l-4 border-blue-400 bg-blue-50/60",
  "Review":         "border-l-4 border-orange-400 bg-orange-50/60",
  "Implementation": "border-l-4 border-teal-400 bg-teal-50/60",
  "Evaluation":     "border-l-4 border-emerald-400 bg-emerald-50/60",
  // Health labels
  "On Track":                   "border-l-4 border-emerald-400 bg-emerald-50/60",
  "At Risk":                    "border-l-4 border-orange-400 bg-orange-50/60",
  "Behind Schedule":            "border-l-4 border-red-400 bg-red-50/60",
  "Delayed — Near Completion":  "border-l-4 border-orange-300 bg-orange-50/40",
};
const GROUP_HEADER_DEFAULT = "border-l-4 border-navy/20 bg-slate-50";

function loadTableState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("no saved state");
    const parsed = JSON.parse(raw);
    return {
      columnOrder: parsed.columnOrder?.length ? parsed.columnOrder : COLUMN_DEFS.map((c) => c.key),
      columnWidths: parsed.columnWidths || {},
      hiddenColumns: new Set(parsed.hiddenColumns || COLUMN_DEFS.map((c) => c.key).filter((k) => !DEFAULT_VISIBLE.has(k))),
      groupBy: parsed.groupBy || "none",
      sortKey: parsed.sortKey || "name",
      sortDir: parsed.sortDir || "asc",
    };
  } catch {
    return {
      columnOrder: COLUMN_DEFS.map((c) => c.key),
      columnWidths: {},
      hiddenColumns: new Set(COLUMN_DEFS.map((c) => c.key).filter((k) => !DEFAULT_VISIBLE.has(k))),
      groupBy: "none",
      sortKey: "name",
      sortDir: "asc",
    };
  }
}

function cellValue(key, ctx) {
  const { p, health, completionPct, nameFor } = ctx;
  switch (key) {
    case "ownerId":    return nameFor(p.ownerId);
    case "approverId": return nameFor(p.approverId);
    case "completion": return Math.round(completionPct);
    case "health":     return health.label;
    case "priority":   return PRIORITY_RANK[p.priority] ?? -1;
    default:           return p[key] ?? "";
  }
}

function CellDisplay({ colKey, p, health, completionPct, nameFor, overdueCount }) {
  switch (colKey) {
    case "name":
      return (
        <div className="flex items-center gap-1.5">
          <Link to={`/projects/${p.id}`} className="text-navy font-medium hover:underline">
            {p.name}
          </Link>
          {overdueCount > 0 && (
            <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5 whitespace-nowrap">
              ⚠ {overdueCount} overdue
            </span>
          )}
        </div>
      );
    case "description":
      return (
        <span className="text-gray-600 truncate block" title={p.description}>
          {p.description || "—"}
        </span>
      );
    case "ownerId":    return <span className="text-gray-600">{nameFor(p.ownerId)}</span>;
    case "approverId": return <span className="text-gray-600">{nameFor(p.approverId)}</span>;
    case "completion": return <span className="text-gray-600">{Math.round(completionPct)}%</span>;

    case "priority": {
      const cls = PRIORITY_PILL[p.priority] || "bg-gray-100 text-gray-500";
      return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{p.priority || "—"}</span>;
    }
    case "developmentType": {
      // Extract "Level N" from the stored value like "Level 1"
      const lvl = p.developmentType || "";
      const cls = EFFORT_PILL[lvl] || "bg-gray-100 text-gray-500";
      return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{lvl || "—"}</span>;
    }
    case "status": {
      const s = PROJECT_STATUSES.includes(p.status) ? p.status : (p.status ? migrateLegacyStatus(p.status).status : "Not Started");
      const cls = STATUS_STYLES[s] || "bg-gray-100 text-gray-500";
      return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{s}</span>;
    }
    case "health":
      return (
        <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${health.style}`}>{health.label}</span>
      );
    case "approvedRevisedEndDate":
      return p.approvedRevisedEndDate ? (
        <span className="text-amber-600">{p.approvedRevisedEndDate} (revised)</span>
      ) : (
        <span className="text-gray-400">—</span>
      );
    case "folderUrl":
      return p.folderUrl ? (
        <a href={p.folderUrl} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">Open ↗</a>
      ) : (
        <span className="text-gray-400">—</span>
      );
    default: {
      const v = p[colKey];
      return <span className="text-gray-600">{v === null || v === undefined || v === "" ? "—" : String(v)}</span>;
    }
  }
}

export default function ProjectsPage() {
  const { user, profile } = useAuth();
  const [projects, setProjects] = useState([]);
  const [users, setUsers] = useState([]);
  const [tasksByProject, setTasksByProject] = useState({});
  const [table, setTable] = useState(loadTableState);
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const dragColRef = useRef(null);
  const resizingRef = useRef(null);

  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const projRef = collection(db, "projects");
    const q = profile?.role === "Admin"
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

    return () => { unsubUsers(); unsubProjects(); unsubTasks(); };
  }, [user, profile]);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...table, hiddenColumns: Array.from(table.hiddenColumns) })
    );
  }, [table]);

  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";

  const today = new Date().toISOString().split("T")[0];

  const rows = useMemo(() => {
    return projects.map((p) => {
      const allTasks = tasksByProject[p.id] || [];
      const { projectCompletion } = computeRollups(allTasks);
      const health = computeHealth(p, projectCompletion);
      const overdueCount = allTasks.filter(
        (t) => !t.parentTaskId && t.dueDate && t.dueDate < today && t.status !== "Done"
      ).length;
      return { p, health, completionPct: projectCompletion, overdueCount };
    });
  }, [projects, tasksByProject, today]);

  const visibleColumns = table.columnOrder.filter((k) => !table.hiddenColumns.has(k));

  const sortRows = (list) => {
    const dir = table.sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = cellValue(table.sortKey, { ...a, nameFor });
      const vb = cellValue(table.sortKey, { ...b, nameFor });
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  };

  const groups = useMemo(() => {
    if (table.groupBy === "none") return [{ label: null, rows: sortRows(rows) }];
    const groupKeyFor = (row) => {
      if (table.groupBy === "status") {
        const s = row.p.status;
        return PROJECT_STATUSES.includes(s) ? s : (s ? migrateLegacyStatus(s).status : "Not Started");
      }
      if (table.groupBy === "phase") {
        const ph = row.p.phase;
        return PROJECT_PHASES.includes(ph) ? ph : (row.p.status ? migrateLegacyStatus(row.p.status).phase : "Scoping");
      }
      if (table.groupBy === "health") return row.health.label;
      if (table.groupBy === "ownerId") return nameFor(row.p.ownerId);
      return "";
    };
    const map = new Map();
    rows.forEach((row) => {
      const k = groupKeyFor(row);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(row);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([label, list]) => ({ label, rows: sortRows(list) }));
  }, [rows, table.groupBy, table.sortKey, table.sortDir, users]);

  const toggleSort = (key) => {
    setTable((t) => ({
      ...t,
      sortKey: key,
      sortDir: t.sortKey === key && t.sortDir === "asc" ? "desc" : "asc",
    }));
  };

  const toggleColumn = (key) => {
    setTable((t) => {
      const next = new Set(t.hiddenColumns);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return { ...t, hiddenColumns: next };
    });
  };

  const resetView = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    setTable(loadTableState());
  };

  const handleDragStart = (key) => (e) => {
    dragColRef.current = key;
    e.dataTransfer.effectAllowed = "move";
  };
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = (key) => (e) => {
    e.preventDefault();
    const from = dragColRef.current;
    if (!from || from === key) return;
    setTable((t) => {
      const order = [...t.columnOrder];
      const fromIdx = order.indexOf(from);
      const toIdx = order.indexOf(key);
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, from);
      return { ...t, columnOrder: order };
    });
    dragColRef.current = null;
  };

  const startResize = (key) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = table.columnWidths[key] || COLUMN_DEFS.find((c) => c.key === key)?.width || 140;
    resizingRef.current = true;
    const onMove = (ev) => {
      const newWidth = Math.max(70, startWidth + (ev.clientX - startX));
      setTable((t) => ({ ...t, columnWidths: { ...t.columnWidths, [key]: newWidth } }));
    };
    const onUp = () => {
      resizingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const gridTemplate = visibleColumns
    .map((k) => `${table.columnWidths[k] || COLUMN_DEFS.find((c) => c.key === k)?.width || 140}px`)
    .join(" ");

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
      <p className="text-xs text-gray-500 mb-3">
        Click a header to sort · drag header to reorder columns · drag right edge to resize · use Columns to show/hide.
      </p>

      <div className="flex items-center gap-2 mb-3 relative">
        <div className="relative">
          <button
            onClick={() => setShowColumnsMenu((s) => !s)}
            className="text-xs font-medium bg-white border border-gray-200 rounded-md px-3 py-1.5 hover:bg-slate-50"
          >
            Columns
          </button>
          {showColumnsMenu && (
            <div className="absolute z-10 mt-1 w-56 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg p-2">
              {COLUMN_DEFS.map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-xs px-2 py-1 hover:bg-slate-50 rounded">
                  <input
                    type="checkbox"
                    checked={!table.hiddenColumns.has(c.key)}
                    onChange={() => toggleColumn(c.key)}
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>

        <select
          value={table.groupBy}
          onChange={(e) => setTable((t) => ({ ...t, groupBy: e.target.value }))}
          className="text-xs border border-gray-200 rounded-md px-2 py-1.5 bg-white"
        >
          <option value="none">No grouping</option>
          <option value="status">Group by Status</option>
          <option value="phase">Group by Phase</option>
          <option value="health">Group by Health</option>
          <option value="ownerId">Group by Owner</option>
        </select>

        <button onClick={resetView} className="text-xs text-gray-400 hover:text-gray-600 underline ml-auto">
          Reset view
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-x-auto">
        <div style={{ minWidth: "max-content" }}>
          {/* Column headers */}
          <div
            className="grid bg-slate-50 text-[10px] text-gray-400 uppercase tracking-wide font-medium border-b border-gray-100"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            {visibleColumns.map((key) => {
              const col = COLUMN_DEFS.find((c) => c.key === key);
              return (
                <div
                  key={key}
                  draggable
                  onDragStart={handleDragStart(key)}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop(key)}
                  onClick={() => toggleSort(key)}
                  className="relative px-3 py-2 cursor-pointer select-none flex items-center gap-1 hover:bg-slate-100 border-r border-gray-100 last:border-r-0"
                  title="Click to sort · drag to reorder · drag right edge to resize"
                >
                  <span className="truncate">{col.label}</span>
                  {table.sortKey === key && <span>{table.sortDir === "asc" ? "▲" : "▼"}</span>}
                  <div
                    onMouseDown={startResize(key)}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-teal-300"
                  />
                </div>
              );
            })}
          </div>

          {/* Rows */}
          {groups.map((group) => (
            <div key={group.label ?? "all"}>
              {group.label !== null && (
                <div
                  className={`px-3 py-1.5 text-[12px] font-semibold text-navy border-b border-gray-100 ${GROUP_HEADER_ACCENT[group.label] || GROUP_HEADER_DEFAULT}`}
                >
                  {group.label}{" "}
                  <span className="text-gray-400 font-normal text-[11px]">({group.rows.length})</span>
                </div>
              )}
              {group.rows.map(({ p, health, completionPct, overdueCount }) => (
                <div
                  key={p.id}
                  className="grid text-[13px] border-b border-gray-50 hover:bg-slate-50"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  {visibleColumns.map((key) => (
                    <div key={key} className="px-3 py-2 overflow-hidden text-ellipsis whitespace-nowrap">
                      <CellDisplay colKey={key} p={p} health={health} completionPct={completionPct} nameFor={nameFor} overdueCount={overdueCount} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}

          {projects.length === 0 && (
            <div className="px-4 py-8 text-center text-gray-400 text-sm">
              No projects yet. Click "+ New Project" to create one from a WBS template.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
