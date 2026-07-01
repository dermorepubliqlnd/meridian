import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collection, collectionGroup, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { computeHealth } from "../../../lib/health";
import { computeRollups } from "../../../lib/completion";

const STORAGE_KEY = "meridian.projectsTable.v1";

// All project-setting/detail/health/status fields EXCEPT Requestor Name and
// Team Members, per Sandy's request (2026-07-01) to keep this list lean while
// still surfacing everything else for ad hoc reporting.
const COLUMN_DEFS = [
  { key: "projectCode", label: "Code", width: 90 },
  { key: "name", label: "Project Name", width: 220 },
  { key: "description", label: "Description", width: 240 },
  { key: "source", label: "Source", width: 130 },
  { key: "requestorDepartment", label: "Requestor Dept.", width: 140 },
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
    case "ownerId":
      return nameFor(p.ownerId);
    case "approverId":
      return nameFor(p.approverId);
    case "completion":
      return Math.round(completionPct);
    case "health":
      return health.label;
    case "priority":
      return PRIORITY_RANK[p.priority] ?? -1;
    default:
      return p[key] ?? "";
  }
}

function CellDisplay({ colKey, p, health, completionPct, nameFor }) {
  switch (colKey) {
    case "name":
      return (
        <Link to={`/projects/${p.id}`} className="text-navy font-medium hover:underline">
          {p.name}
        </Link>
      );
    case "description":
      return (
        <span className="text-gray-600 truncate block" title={p.description}>
          {p.description || "—"}
        </span>
      );
    case "ownerId":
      return <span className="text-gray-600">{nameFor(p.ownerId)}</span>;
    case "approverId":
      return <span className="text-gray-600">{nameFor(p.approverId)}</span>;
    case "completion":
      return <span className="text-gray-600">{Math.round(completionPct)}%</span>;
    case "status":
      return <span className="text-gray-500 text-[11px]">{p.status || "Scoping"}</span>;
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
        <a href={p.folderUrl} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">
          Open ↗
        </a>
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

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...table, hiddenColumns: Array.from(table.hiddenColumns) })
    );
  }, [table]);

  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";

  const rows = useMemo(() => {
    return projects.map((p) => {
      const { projectCompletion } = computeRollups(tasksByProject[p.id] || []);
      const health = computeHealth(p, projectCompletion);
      return { p, health, completionPct: projectCompletion };
    });
  }, [projects, tasksByProject]);

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
      if (table.groupBy === "status") return row.p.status || "Scoping";
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
        Drag column headers to reorder, drag the right edge to resize, click a header to sort.
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
          <option value="health">Group by Health</option>
          <option value="ownerId">Group by Owner</option>
        </select>

        <button onClick={resetView} className="text-xs text-gray-400 hover:text-gray-600 underline ml-auto">
          Reset view
        </button>
      </div>

      <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-x-auto">
        <div style={{ minWidth: "max-content" }}>
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
                  title="Click to sort, drag to reorder"
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

          {groups.map((group) => (
            <div key={group.label ?? "all"}>
              {group.label !== null && (
                <div className="px-3 py-1.5 bg-slate-100/70 text-[11px] font-semibold text-navy border-b border-gray-100">
                  {group.label} <span className="text-gray-400 font-normal">({group.rows.length})</span>
                </div>
              )}
              {group.rows.map(({ p, health, completionPct }) => (
                <div
                  key={p.id}
                  className="grid text-[13px] border-b border-gray-50 hover:bg-slate-50"
                  style={{ gridTemplateColumns: gridTemplate }}
                >
                  {visibleColumns.map((key) => (
                    <div key={key} className="px-3 py-2 overflow-hidden text-ellipsis whitespace-nowrap">
                      <CellDisplay colKey={key} p={p} health={health} completionPct={completionPct} nameFor={nameFor} />
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
