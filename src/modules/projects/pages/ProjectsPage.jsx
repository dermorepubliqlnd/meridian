import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection, collectionGroup, onSnapshot, query, where,
  addDoc, deleteDoc, doc,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import {
  computeHealth, STATUS_STYLES, PHASE_STYLES,
  PROJECT_STATUSES, PROJECT_PHASES, migrateLegacyStatus,
} from "../../../lib/health";
import { computeRollups } from "../../../lib/completion";

// ── Storage ──────────────────────────────────────────────────────────────────
const STORAGE_KEY = "meridian.projectsTable.v1";

// ── Column definitions ────────────────────────────────────────────────────────
const COLUMN_DEFS = [
  { key: "projectCode",          label: "Code",               width: 90  },
  { key: "name",                 label: "Project Name",       width: 220 },
  { key: "description",          label: "Description",        width: 240 },
  { key: "source",               label: "Source",             width: 130 },
  { key: "requestorDepartment",  label: "Requestor Dept.",    width: 140 },
  { key: "ticketNumber",         label: "Ticket #",           width: 110 },
  { key: "priority",             label: "Priority",           width: 100 },
  { key: "startDate",            label: "Start Date",         width: 110 },
  { key: "workTypeName",         label: "Work Type",          width: 170 },
  { key: "trainingType",         label: "Training Type",      width: 140 },
  { key: "deliveryFormat",       label: "Delivery Format",    width: 140 },
  { key: "developmentType",      label: "Effort Level",       width: 130 },
  { key: "ownerId",              label: "Owner",              width: 140 },
  { key: "approverId",           label: "Approver",           width: 140 },
  { key: "baselineStatus",       label: "Baseline Status",    width: 140 },
  { key: "baselineEndDate",      label: "Baseline End Date",  width: 140 },
  { key: "approvedRevisedEndDate", label: "Approved Revised End", width: 160 },
  { key: "actualCompletionDate", label: "Actual Completion",  width: 140 },
  { key: "completion",           label: "Completion %",       width: 110 },
  { key: "status",               label: "Status",             width: 120 },
  { key: "phase",                label: "Phase",              width: 130 },
  { key: "health",               label: "Health",             width: 160 },
  { key: "smeName",              label: "SME",                width: 140 },
  { key: "targetLaunchDate",     label: "Target Launch",      width: 130 },
  { key: "memberCount",          label: "Team Size",          width: 90  },
  { key: "folderUrl",            label: "Folder",             width: 90  },
];

const DEFAULT_VISIBLE = new Set([
  "name", "ownerId", "priority", "status", "health",
  "completion", "baselineEndDate", "startDate", "workTypeName",
]);

const PRIORITY_RANK = { Low: 0, Medium: 1, High: 2 };

// ── Pill styles ───────────────────────────────────────────────────────────────
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

const GROUP_HEADER_ACCENT = {
  "Not Started":               "border-l-4 border-gray-300 bg-gray-50",
  "Active":                    "border-l-4 border-blue-400 bg-blue-50/60",
  "On Hold":                   "border-l-4 border-amber-400 bg-amber-50/60",
  "Done":                      "border-l-4 border-emerald-400 bg-emerald-50/60",
  "Canceled":                  "border-l-4 border-red-300 bg-red-50/60",
  "Scoping":                   "border-l-4 border-slate-400 bg-slate-50",
  "Planning":                  "border-l-4 border-yellow-400 bg-yellow-50/60",
  "Design":                    "border-l-4 border-purple-400 bg-purple-50/60",
  "Development":               "border-l-4 border-blue-400 bg-blue-50/60",
  "Review":                    "border-l-4 border-orange-400 bg-orange-50/60",
  "Implementation":            "border-l-4 border-teal-400 bg-teal-50/60",
  "Evaluation":                "border-l-4 border-emerald-400 bg-emerald-50/60",
  "On Track":                  "border-l-4 border-emerald-400 bg-emerald-50/60",
  "At Risk":                   "border-l-4 border-orange-400 bg-orange-50/60",
  "Behind Schedule":           "border-l-4 border-red-400 bg-red-50/60",
  "Delayed — Near Completion": "border-l-4 border-orange-300 bg-orange-50/40",
};
const GROUP_HEADER_DEFAULT = "border-l-4 border-navy/20 bg-slate-50";

// ── Board view config ─────────────────────────────────────────────────────────
// Board grouping options
const BOARD_GROUP_OPTIONS = [
  { key: "status",   label: "Status"   },
  { key: "phase",    label: "Phase"    },
  { key: "owner",    label: "Owner"    },
  { key: "health",   label: "Health"   },
  { key: "priority", label: "Priority" },
];

// Static columns per grouping (dynamic ones like owner are computed at render)
const BOARD_COLUMNS_BY_GROUP = {
  status: [
    { key: "Not Started", accent: "border-gray-300",    bg: "bg-gray-50",       dot: "bg-gray-400"    },
    { key: "Active",      accent: "border-blue-300",    bg: "bg-blue-50",       dot: "bg-blue-500"    },
    { key: "On Hold",     accent: "border-amber-300",   bg: "bg-amber-50",      dot: "bg-amber-500"   },
    { key: "Done",        accent: "border-emerald-300", bg: "bg-emerald-50",    dot: "bg-emerald-500" },
    { key: "Canceled",    accent: "border-red-200",     bg: "bg-red-50",        dot: "bg-red-400"     },
  ],
  phase: [
    { key: "Scoping",        accent: "border-slate-400",   bg: "bg-slate-50",      dot: "bg-slate-400"   },
    { key: "Planning",       accent: "border-yellow-400",  bg: "bg-yellow-50",     dot: "bg-yellow-500"  },
    { key: "Design",         accent: "border-purple-400",  bg: "bg-purple-50",     dot: "bg-purple-500"  },
    { key: "Development",    accent: "border-blue-400",    bg: "bg-blue-50",       dot: "bg-blue-500"    },
    { key: "Review",         accent: "border-orange-400",  bg: "bg-orange-50",     dot: "bg-orange-500"  },
    { key: "Implementation", accent: "border-teal-400",    bg: "bg-teal-50",       dot: "bg-teal-500"    },
    { key: "Evaluation",     accent: "border-emerald-400", bg: "bg-emerald-50",    dot: "bg-emerald-500" },
  ],
  health: [
    { key: "On Track",        accent: "border-emerald-400", bg: "bg-emerald-50",  dot: "bg-emerald-500" },
    { key: "At Risk",         accent: "border-amber-400",   bg: "bg-amber-50",    dot: "bg-amber-500"   },
    { key: "Behind Schedule", accent: "border-red-400",     bg: "bg-red-50",      dot: "bg-red-500"     },
    { key: "On Hold",         accent: "border-gray-300",    bg: "bg-gray-50",     dot: "bg-gray-400"    },
    { key: "Scoping",         accent: "border-slate-300",   bg: "bg-slate-50",    dot: "bg-slate-400"   },
  ],
  priority: [
    { key: "High",   accent: "border-red-300",     bg: "bg-red-50",     dot: "bg-red-500"     },
    { key: "Medium", accent: "border-yellow-300",  bg: "bg-yellow-50",  dot: "bg-yellow-500"  },
    { key: "Low",    accent: "border-emerald-300", bg: "bg-emerald-50", dot: "bg-emerald-500" },
  ],
};

// Card fields config
const CARD_FIELD_DEFS = [
  { key: "phase",       label: "Phase"       },
  { key: "priority",    label: "Priority"    },
  { key: "health",      label: "Health"      },
  { key: "owner",       label: "Owner"       },
  { key: "completion",  label: "Completion"  },
  { key: "overdue",     label: "Overdue tag" },
  { key: "endDate",     label: "End Date"    },
];
const DEFAULT_CARD_FIELDS = new Set(["phase","priority","health","owner","completion","overdue"]);

const DEFAULT_BOARD_CONFIG = {
  groupBy:    "status",
  sortBy:     "name",
  sortDir:    "asc",
  cardFields: DEFAULT_CARD_FIELDS,
};

// ── View type icons ───────────────────────────────────────────────────────────
const VIEW_ICONS = {
  list:     "☰",
  board:    "⬛",
  timeline: "━",
  calendar: "⊞",
};

// ── localStorage helpers ──────────────────────────────────────────────────────
function loadTableState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error();
    const p = JSON.parse(raw);
    return {
      columnOrder:   p.columnOrder?.length ? p.columnOrder : COLUMN_DEFS.map((c) => c.key),
      columnWidths:  p.columnWidths || {},
      hiddenColumns: new Set(p.hiddenColumns || COLUMN_DEFS.map((c) => c.key).filter((k) => !DEFAULT_VISIBLE.has(k))),
      groupBy:       p.groupBy || "none",
      sortKey:       p.sortKey || "name",
      sortDir:       p.sortDir || "asc",
    };
  } catch {
    return {
      columnOrder:   COLUMN_DEFS.map((c) => c.key),
      columnWidths:  {},
      hiddenColumns: new Set(COLUMN_DEFS.map((c) => c.key).filter((k) => !DEFAULT_VISIBLE.has(k))),
      groupBy:       "none",
      sortKey:       "name",
      sortDir:       "asc",
    };
  }
}

// ── Cell value for sorting ────────────────────────────────────────────────────
function cellValue(key, ctx) {
  const { p, health, completionPct, nameFor } = ctx;
  switch (key) {
    case "ownerId":     return nameFor(p.ownerId);
    case "approverId":  return nameFor(p.approverId);
    case "completion":  return Math.round(completionPct);
    case "health":      return health.label;
    case "phase":       return p.phase ?? "";
    case "memberCount": return p.memberIds?.length || 0;
    case "priority":    return PRIORITY_RANK[p.priority] ?? -1;
    default:            return p[key] ?? "";
  }
}

// ── Cell renderer ─────────────────────────────────────────────────────────────
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
      return <span className="text-gray-600 truncate block" title={p.description}>{p.description || "—"}</span>;
    case "ownerId":    return <span className="text-gray-600">{nameFor(p.ownerId)}</span>;
    case "approverId": return <span className="text-gray-600">{nameFor(p.approverId)}</span>;
    case "completion": return <span className="text-gray-600">{Math.round(completionPct)}%</span>;
    case "priority": {
      const cls = PRIORITY_PILL[p.priority] || "bg-gray-100 text-gray-500";
      return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{p.priority || "—"}</span>;
    }
    case "developmentType": {
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
      return <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${health.style}`}>{health.label}</span>;
    case "approvedRevisedEndDate":
      return p.approvedRevisedEndDate
        ? <span className="text-amber-600">{p.approvedRevisedEndDate} (revised)</span>
        : <span className="text-gray-400">—</span>;
    case "folderUrl":
      return p.folderUrl
        ? <a href={p.folderUrl} target="_blank" rel="noreferrer" className="text-teal-700 hover:underline">Open ↗</a>
        : <span className="text-gray-400">—</span>;
    case "phase": {
      const ph = p.phase || "—";
      const cls = PHASE_STYLES[ph] || "bg-gray-100 text-gray-500";
      return <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{ph || "—"}</span>;
    }
    case "smeName":          return <span className="text-gray-600">{p.smeName || "—"}</span>;
    case "targetLaunchDate": return <span className="text-gray-600">{p.targetLaunchDate || "—"}</span>;
    case "memberCount":      return <span className="text-gray-600">{p.memberIds?.length || 0}</span>;
    default: {
      const v = p[colKey];
      return <span className="text-gray-600">{v === null || v === undefined || v === "" ? "—" : String(v)}</span>;
    }
  }
}

// ── Board view ────────────────────────────────────────────────────────────────
function BoardView({ rows, nameFor, boardConfig }) {
  const { groupBy, sortBy, sortDir, cardFields } = boardConfig;

  // Build columns dynamically
  const buildColumns = () => {
    if (groupBy === "owner") {
      // Dynamic: one column per unique owner
      const owners = [...new Set(rows.map(r => nameFor(r.p.ownerId)))].sort();
      return owners.map(name => ({
        key: name,
        accent: "border-navy/30",
        bg: "bg-slate-50",
        dot: "bg-navy",
      }));
    }
    return BOARD_COLUMNS_BY_GROUP[groupBy] || BOARD_COLUMNS_BY_GROUP.status;
  };

  const columns = buildColumns();

  // Get group key for a row
  const groupKey = (r) => {
    if (groupBy === "status") {
      const s = r.p.status;
      return PROJECT_STATUSES.includes(s) ? s : (s ? migrateLegacyStatus(s).status : "Not Started");
    }
    if (groupBy === "phase")    return r.p.phase || "Scoping";
    if (groupBy === "owner")    return nameFor(r.p.ownerId);
    if (groupBy === "health")   return r.health.label;
    if (groupBy === "priority") return r.p.priority || "Low";
    return "";
  };

  // Sort within columns
  const sortedRows = (list) => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      let va, vb;
      if (sortBy === "priority") { va = PRIORITY_RANK[a.p.priority] ?? -1; vb = PRIORITY_RANK[b.p.priority] ?? -1; }
      else if (sortBy === "completion") { va = a.completionPct; vb = b.completionPct; }
      else if (sortBy === "endDate") { va = a.p.baselineEndDate || ""; vb = b.p.baselineEndDate || ""; }
      else { va = a.p.name || ""; vb = b.p.name || ""; }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  };

  // Collect rows for a column (including "others" fallback)
  const colRows = (colKey, isLast) => {
    const matched = rows.filter(r => groupKey(r) === colKey);
    if (isLast) {
      const knownKeys = columns.map(c => c.key);
      const others = rows.filter(r => !knownKeys.includes(groupKey(r)));
      return sortedRows([...matched, ...others]);
    }
    return sortedRows(matched);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2 items-start">
      {columns.map((col, idx) => {
        const items = colRows(col.key, idx === columns.length - 1);
        return (
          <div key={col.key} className="flex-shrink-0 w-64">
            <div className={`flex items-center gap-2 px-3 py-2 rounded-t-lg border-t-2 ${col.accent} ${col.bg} border-x border-gray-200`}>
              <span className={`w-2 h-2 rounded-full ${col.dot}`} />
              <span className="text-xs font-semibold text-gray-700">{col.key}</span>
              <span className="ml-auto text-xs text-gray-400">{items.length}</span>
            </div>
            <div className={`flex flex-col gap-2 p-2 min-h-[120px] rounded-b-lg border border-t-0 border-gray-200 ${col.bg}`}>
              {items.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4">No projects</p>
              )}
              {items.map(({ p, health, completionPct, overdueCount }) => (
                <Link
                  key={p.id}
                  to={`/projects/${p.id}`}
                  className="block bg-white rounded-lg border border-gray-200 shadow-sm px-3 py-2.5 hover:shadow-md hover:border-teal-300 transition group"
                >
                  <p className="text-[13px] font-semibold text-navy group-hover:underline leading-snug mb-1.5">
                    {p.name}
                  </p>
                  {/* Badges row */}
                  <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                    {cardFields.has("phase") && p.phase && (
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-medium ${PHASE_STYLES[p.phase] || "bg-gray-100 text-gray-500"}`}>
                        {p.phase}
                      </span>
                    )}
                    {cardFields.has("priority") && p.priority && (
                      <span className={`text-[10px] rounded-full px-1.5 py-0.5 font-medium ${PRIORITY_PILL[p.priority] || "bg-gray-100 text-gray-500"}`}>
                        {p.priority}
                      </span>
                    )}
                    {cardFields.has("overdue") && overdueCount > 0 && (
                      <span className="text-[10px] font-semibold text-red-600 bg-red-50 border border-red-200 rounded-full px-1.5 py-0.5">
                        ⚠ {overdueCount} overdue
                      </span>
                    )}
                  </div>
                  {/* Completion bar */}
                  {cardFields.has("completion") && (
                    <div className="mb-2">
                      <div className="flex justify-between text-[10px] text-gray-400 mb-0.5">
                        <span>Completion</span>
                        <span>{Math.round(completionPct)}%</span>
                      </div>
                      <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
                        <div className="h-full bg-teal-500 rounded-full" style={{ width: `${completionPct}%` }} />
                      </div>
                    </div>
                  )}
                  {/* End date */}
                  {cardFields.has("endDate") && (p.baselineEndDate || p.approvedRevisedEndDate) && (
                    <p className="text-[10px] text-gray-400 mb-1.5">
                      Due: {p.approvedRevisedEndDate || p.baselineEndDate}
                    </p>
                  )}
                  {/* Footer */}
                  <div className="flex items-center justify-between">
                    {cardFields.has("owner") && (
                      <span className="text-[11px] text-gray-500 truncate">{nameFor(p.ownerId)}</span>
                    )}
                    {cardFields.has("health") && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${health.style}`}>
                        {health.label}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Coming soon placeholder ───────────────────────────────────────────────────
function ComingSoonView({ viewName }) {
  return (
    <div className="flex flex-col items-center justify-center bg-white rounded-lg border border-gray-100 shadow-sm py-20 text-center">
      <span className="text-4xl mb-3">{viewName === "timeline" ? "━" : "⊞"}</span>
      <p className="text-base font-semibold text-navy mb-1">
        {viewName === "timeline" ? "Timeline (Gantt)" : "Calendar"} view
      </p>
      <p className="text-sm text-gray-400">Coming soon — this view is on the roadmap.</p>
    </div>
  );
}

// ── Save view modal ───────────────────────────────────────────────────────────
function SaveViewModal({ onSave, onClose }) {
  const [name, setName] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-80 p-5">
        <h3 className="text-sm font-semibold text-navy mb-3">Save current view</h3>
        <input
          autoFocus
          type="text"
          placeholder="View name (e.g. My Active Projects)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) onSave(name.trim()); }}
          className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5">
            Cancel
          </button>
          <button
            disabled={!name.trim()}
            onClick={() => onSave(name.trim())}
            className="text-sm bg-navy text-white px-4 py-1.5 rounded-md hover:bg-navy-light disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const { user, profile } = useAuth();

  // Data
  const [projects, setProjects]         = useState([]);
  const [users, setUsers]               = useState([]);
  const [tasksByProject, setTasksByProject] = useState({});

  // Table config (list view)
  const [table, setTable]               = useState(loadTableState);
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);

  // View management
  const [viewType, setViewType]         = useState("list");
  const [savedViews, setSavedViews]     = useState([]);
  const [activeViewId, setActiveViewId] = useState(null);
  const [activeViewName, setActiveViewName] = useState(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showViewsMenu, setShowViewsMenu] = useState(false);
  const [boardConfig, setBoardConfig] = useState(DEFAULT_BOARD_CONFIG);
  const [showBoardFieldsMenu, setShowBoardFieldsMenu] = useState(false);

  const dragColRef  = useRef(null);
  const resizingRef = useRef(null);

  // ── Firestore subscriptions ──────────────────────────────────────────────
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

  // ── Saved views subscription ─────────────────────────────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    const viewsRef = collection(db, "users", user.uid, "views");
    const unsub = onSnapshot(viewsRef, (snap) => {
      setSavedViews(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user?.uid]);

  // ── Persist table state ──────────────────────────────────────────────────
  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...table, hiddenColumns: Array.from(table.hiddenColumns) })
    );
  }, [table]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";
  const today   = new Date().toISOString().split("T")[0];

  const rows = useMemo(() => {
    return projects.map((p) => {
      const allTasks = tasksByProject[p.id] || [];
      const { projectCompletion } = computeRollups(allTasks);
      const health       = computeHealth(p, projectCompletion);
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

  // ── Table interactions ───────────────────────────────────────────────────
  const toggleSort   = (key) => setTable((t) => ({
    ...t, sortKey: key, sortDir: t.sortKey === key && t.sortDir === "asc" ? "desc" : "asc",
  }));
  const toggleColumn = (key) => setTable((t) => {
    const next = new Set(t.hiddenColumns);
    if (next.has(key)) next.delete(key); else next.add(key);
    return { ...t, hiddenColumns: next };
  });
  const resetView = () => { window.localStorage.removeItem(STORAGE_KEY); setTable(loadTableState()); };

  const handleDragStart = (key) => (e) => { dragColRef.current = key; e.dataTransfer.effectAllowed = "move"; };
  const handleDragOver  = (e)   => e.preventDefault();
  const handleDrop      = (key) => (e) => {
    e.preventDefault();
    const from = dragColRef.current;
    if (!from || from === key) return;
    setTable((t) => {
      const order = [...t.columnOrder];
      order.splice(order.indexOf(from), 1);
      order.splice(order.indexOf(key), 0, from);
      return { ...t, columnOrder: order };
    });
    dragColRef.current = null;
  };
  const startResize = (key) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX     = e.clientX;
    const startWidth = table.columnWidths[key] || COLUMN_DEFS.find((c) => c.key === key)?.width || 140;
    resizingRef.current = true;
    const onMove = (ev) => {
      const w = Math.max(70, startWidth + (ev.clientX - startX));
      setTable((t) => ({ ...t, columnWidths: { ...t.columnWidths, [key]: w } }));
    };
    const onUp = () => { resizingRef.current = false; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const gridTemplate = visibleColumns
    .map((k) => `${table.columnWidths[k] || COLUMN_DEFS.find((c) => c.key === k)?.width || 140}px`)
    .join(" ");

  // ── Saved views actions ──────────────────────────────────────────────────
  const handleSaveView = async (name) => {
    const viewsRef = collection(db, "users", user.uid, "views");
    await addDoc(viewsRef, {
      name,
      viewType,
      tableConfig: viewType === "list"
        ? { ...table, hiddenColumns: Array.from(table.hiddenColumns) }
        : {},
      createdAt: new Date().toISOString(),
    });
    setActiveViewName(name);
    setShowSaveModal(false);
  };

  const handleLoadView = (sv) => {
    setViewType(sv.viewType || "list");
    if (sv.viewType === "list" && sv.tableConfig) {
      setTable({
        columnOrder:   sv.tableConfig.columnOrder || COLUMN_DEFS.map((c) => c.key),
        columnWidths:  sv.tableConfig.columnWidths || {},
        hiddenColumns: new Set(sv.tableConfig.hiddenColumns || []),
        groupBy:       sv.tableConfig.groupBy || "none",
        sortKey:       sv.tableConfig.sortKey || "name",
        sortDir:       sv.tableConfig.sortDir || "asc",
      });
    }
    setActiveViewId(sv.id);
    setActiveViewName(sv.name);
    setShowViewsMenu(false);
  };

  const handleDeleteView = async (e, id) => {
    e.stopPropagation();
    await deleteDoc(doc(db, "users", user.uid, "views", id));
    if (activeViewId === id) { setActiveViewId(null); setActiveViewName(null); }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-bold font-heading text-navy">Projects</h2>
        <Link
          to="/projects/new"
          className="bg-navy text-white text-sm font-medium px-3 py-1.5 rounded-md hover:bg-navy-light transition"
        >
          + New Project
        </Link>
      </div>

      {/* Metric cards */}
      <div className="flex flex-wrap gap-3 mb-4">
        {[
          { label: "Active",  count: rows.filter(r => r.p.status === "Active").length,                              color: "text-blue-700",    bg: "bg-blue-50",    border: "border-blue-200"   },
          { label: "At Risk", count: rows.filter(r => r.health?.label === "At Risk").length,                        color: "text-amber-600",   bg: "bg-amber-50",   border: "border-amber-200"  },
          { label: "Behind",  count: rows.filter(r => r.health?.label === "Behind Schedule").length,                color: "text-red-600",     bg: "bg-red-50",     border: "border-red-200"    },
          { label: "On Hold", count: rows.filter(r => r.p.status === "On Hold").length,                             color: "text-gray-600",    bg: "bg-gray-100",   border: "border-gray-200"   },
          { label: "Done",    count: rows.filter(r => r.p.status === "Done" || r.p.status === "Canceled").length,   color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200" },
        ].map(({ label, count, color, bg, border }) => (
          <div key={label} className={`flex flex-col items-center px-4 py-2 rounded-lg border ${bg} ${border} min-w-[72px]`}>
            <span className={`text-xl font-bold font-heading ${color}`}>{count}</span>
            <span className="text-[11px] text-gray-500 mt-0.5">{label}</span>
          </div>
        ))}
      </div>

      {/* ── View switcher bar ── */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {/* View type buttons */}
        <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs font-medium bg-white">
          {[
            { key: "list",     label: "List"     },
            { key: "board",    label: "Board"    },
            { key: "timeline", label: "Timeline" },
            { key: "calendar", label: "Calendar" },
          ].map((v) => (
            <button
              key={v.key}
              onClick={() => { setViewType(v.key); setActiveViewId(null); setActiveViewName(null); }}
              className={`px-3 py-1.5 border-r border-gray-200 last:border-r-0 transition ${
                viewType === v.key
                  ? "bg-navy text-white"
                  : "hover:bg-slate-50 text-gray-600"
              }`}
            >
              {VIEW_ICONS[v.key]} {v.label}
            </button>
          ))}
        </div>

        {/* Saved views dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowViewsMenu((s) => !s)}
            className="text-xs font-medium bg-white border border-gray-200 rounded-md px-3 py-1.5 hover:bg-slate-50 flex items-center gap-1"
          >
            {activeViewName
              ? <span className="text-navy font-semibold">{activeViewName}</span>
              : <span className="text-gray-500">Saved views</span>}
            <span className="text-gray-400">▾</span>
          </button>
          {showViewsMenu && (
            <div className="absolute z-20 mt-1 w-56 bg-white border border-gray-200 rounded-md shadow-lg py-1">
              {savedViews.length === 0 && (
                <p className="text-xs text-gray-400 px-3 py-2">No saved views yet.</p>
              )}
              {savedViews.map((sv) => (
                <div
                  key={sv.id}
                  onClick={() => handleLoadView(sv)}
                  className={`flex items-center justify-between px-3 py-1.5 text-xs cursor-pointer hover:bg-slate-50 ${
                    activeViewId === sv.id ? "text-navy font-semibold" : "text-gray-700"
                  }`}
                >
                  <span className="truncate">
                    {VIEW_ICONS[sv.viewType] || "☰"} {sv.name}
                  </span>
                  <button
                    onClick={(e) => handleDeleteView(e, sv.id)}
                    className="text-gray-300 hover:text-red-400 ml-2 flex-shrink-0"
                    title="Delete view"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Save current view */}
        <button
          onClick={() => setShowSaveModal(true)}
          className="text-xs font-medium bg-white border border-gray-200 rounded-md px-3 py-1.5 hover:bg-slate-50 text-teal-700"
        >
          + Save view
        </button>

        {/* List-view controls */}
        {viewType === "list" && (
          <>
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
                      <input type="checkbox" checked={!table.hiddenColumns.has(c.key)} onChange={() => toggleColumn(c.key)} />
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

            <button onClick={resetView} className="text-xs text-gray-400 hover:text-gray-600 underline">
              Reset view
            </button>
          </>
        )}

        {/* Active view label */}
        {activeViewName && (
          <span className="ml-auto text-xs text-gray-400 italic">Viewing: {activeViewName}</span>
        )}
      </div>

      {/* ── View content ── */}
      {viewType === "list" && (
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

            {groups.map((group) => (
              <div key={group.label ?? "all"}>
                {group.label !== null && (
                  <div className={`px-3 py-1.5 text-[12px] font-semibold text-navy border-b border-gray-100 ${GROUP_HEADER_ACCENT[group.label] || GROUP_HEADER_DEFAULT}`}>
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
      )}

      {viewType === "board" && (
        <>
          {/* Board toolbar */}
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            {/* Group by */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-400 font-medium">Group by</span>
              <select
                value={boardConfig.groupBy}
                onChange={(e) => setBoardConfig(c => ({ ...c, groupBy: e.target.value }))}
                className="border border-gray-200 rounded-md px-2 py-1.5 bg-white text-xs"
              >
                {BOARD_GROUP_OPTIONS.map(o => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Sort within columns */}
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-gray-400 font-medium">Sort</span>
              <select
                value={boardConfig.sortBy}
                onChange={(e) => setBoardConfig(c => ({ ...c, sortBy: e.target.value }))}
                className="border border-gray-200 rounded-md px-2 py-1.5 bg-white text-xs"
              >
                <option value="name">Name</option>
                <option value="priority">Priority</option>
                <option value="completion">Completion</option>
                <option value="endDate">End Date</option>
              </select>
              <button
                onClick={() => setBoardConfig(c => ({ ...c, sortDir: c.sortDir === "asc" ? "desc" : "asc" }))}
                className="border border-gray-200 rounded-md px-2 py-1.5 bg-white hover:bg-slate-50"
                title="Toggle sort direction"
              >
                {boardConfig.sortDir === "asc" ? "▲" : "▼"}
              </button>
            </div>

            {/* Card fields */}
            <div className="relative">
              <button
                onClick={() => setShowBoardFieldsMenu(s => !s)}
                className="text-xs font-medium bg-white border border-gray-200 rounded-md px-3 py-1.5 hover:bg-slate-50"
              >
                Card fields
              </button>
              {showBoardFieldsMenu && (
                <div className="absolute z-10 mt-1 w-44 bg-white border border-gray-200 rounded-md shadow-lg p-2">
                  {CARD_FIELD_DEFS.map(f => (
                    <label key={f.key} className="flex items-center gap-2 text-xs px-2 py-1 hover:bg-slate-50 rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={boardConfig.cardFields.has(f.key)}
                        onChange={() => setBoardConfig(c => {
                          const next = new Set(c.cardFields);
                          if (next.has(f.key)) next.delete(f.key); else next.add(f.key);
                          return { ...c, cardFields: next };
                        })}
                      />
                      {f.label}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <BoardView rows={rows} nameFor={nameFor} boardConfig={boardConfig} />
        </>
      )}
      {viewType === "timeline" && <ComingSoonView viewName="timeline" />}
      {viewType === "calendar" && <ComingSoonView viewName="calendar" />}

      {/* Save view modal */}
      {showSaveModal && (
        <SaveViewModal
          onSave={handleSaveView}
          onClose={() => setShowSaveModal(false)}
        />
      )}
    </div>
  );
}
