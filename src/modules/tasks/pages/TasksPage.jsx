import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { collectionGroup, collection, onSnapshot } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { STATUS_STYLES } from "../../../lib/taskColors";

// ── Column definitions ────────────────────────────────────────────────────────
const ALL_COLS = [
  { key: "name",        label: "Task",       defaultWidth: 240, fixed: true },
  { key: "project",     label: "Project",    defaultWidth: 160 },
  { key: "phase",       label: "Phase",      defaultWidth: 110 },
  { key: "assignee",    label: "Assignee",   defaultWidth: 120 },
  { key: "status",      label: "Status",     defaultWidth: 130 },
  { key: "startDate",   label: "Start",      defaultWidth: 95 },
  { key: "dueDate",     label: "Due",        defaultWidth: 95 },
  { key: "estHours",    label: "Est. Hrs",   defaultWidth: 75, align: "right" },
  { key: "actualHours", label: "Actual Hrs", defaultWidth: 80, align: "right" },
];
const COL_MAP = Object.fromEntries(ALL_COLS.map((c) => [c.key, c]));
const DEFAULT_COL_ORDER = ALL_COLS.map((c) => c.key);

const DEFAULT_VIEW = {
  id: "default",
  name: "All Tasks",
  type: "list",
  groupBy: null,
  hiddenCols: [],
  colOrder: DEFAULT_COL_ORDER,
  sortCol: "dueDate",
  sortDir: "asc",
  filterAssignee: "all",
};
const LS_VIEWS   = "meridian_task_views_v2";
const LS_ACTIVE  = "meridian_task_active_view_v2";
const LS_WIDTHS  = "meridian_task_col_widths_v2";
function loadViews()   { try { return JSON.parse(localStorage.getItem(LS_VIEWS)) || []; }  catch { return []; } }
function loadWidths()  { try { return JSON.parse(localStorage.getItem(LS_WIDTHS)) || {}; } catch { return {}; } }
function ruid()        { return Math.random().toString(36).slice(2, 9); }

// ── Small helpers ─────────────────────────────────────────────────────────────
function StatusPill({ status }) {
  const cls = STATUS_STYLES[status] || STATUS_STYLES["Not Started"];
  return <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium border-l-2 ${cls}`}>{status || "Not Started"}</span>;
}
function isoWeekStart(dateStr) {
  const d = new Date(dateStr);
  const day = d.getDay();
  d.setDate(d.getDate() - day);
  return d.toISOString().slice(0, 10);
}
function fmtDate(s) { return s ? s.slice(5) : "—"; } // MM-DD

// ── Gantt View ────────────────────────────────────────────────────────────────
const GANTT_WEEKS = 10;
function GanttView({ rows, projects }) {
  const today    = new Date();
  const winStart = new Date(today); winStart.setDate(today.getDate() - today.getDay());
  const winEnd   = new Date(winStart); winEnd.setDate(winStart.getDate() + GANTT_WEEKS * 7);
  const totalMs  = winEnd - winStart;
  const pct      = (dateStr) => { if (!dateStr) return null; const p = (new Date(dateStr) - winStart) / totalMs * 100; return Math.min(100, Math.max(0, p)); };
  const todayPct = pct(today.toISOString().slice(0, 10));
  const weeks    = Array.from({ length: GANTT_WEEKS }, (_, i) => { const d = new Date(winStart); d.setDate(d.getDate() + i * 7); return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" }); });

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex text-[12px]">
        <div className="w-52 shrink-0 border-r border-gray-200">
          <div className="h-8 bg-slate-50 border-b border-gray-200 px-3 flex items-center text-[10px] text-gray-400 uppercase tracking-wide">Task</div>
          {rows.map((t) => (
            <div key={`${t.projectId}-${t.id}`} className="h-8 px-3 flex items-center border-b border-gray-100 text-[12px] text-gray-700 truncate hover:bg-slate-50/50">
              {t.name}
            </div>
          ))}
        </div>
        <div className="flex-1 overflow-x-auto">
          <div className="relative" style={{ minWidth: 540 }}>
            <div className="flex h-8 bg-slate-50 border-b border-gray-200">
              {weeks.map((lbl, i) => (
                <div key={i} className="flex-1 border-r border-gray-100 px-1 flex items-center text-[10px] text-gray-400">{lbl}</div>
              ))}
            </div>
            {todayPct !== null && (
              <div className="absolute top-0 bottom-0 w-px bg-red-400 z-10 pointer-events-none" style={{ left: `${todayPct}%` }} />
            )}
            {rows.map((t) => {
              const lp = pct(t.startDate); const rp = pct(t.dueDate);
              const w = rp !== null && lp !== null ? Math.max(rp - lp, 0.5) : null;
              return (
                <div key={`${t.projectId}-${t.id}`} className="relative h-8 border-b border-gray-100 flex items-center">
                  {weeks.map((_, i) => <div key={i} className="absolute top-0 bottom-0 border-r border-gray-100" style={{ left: `${(i / GANTT_WEEKS) * 100}%` }} />)}
                  {lp !== null && w !== null && (
                    <div className="absolute h-4 rounded bg-teal-500/80 text-white text-[10px] flex items-center px-1.5 overflow-hidden z-10"
                      style={{ left: `${lp}%`, width: `${w}%` }} title={`${t.startDate} → ${t.dueDate}`}>
                      {w > 8 ? t.name : ""}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Calendar View ─────────────────────────────────────────────────────────────
function CalendarView({ rows }) {
  const [cur, setCur] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const yr = cur.getFullYear(); const mo = cur.getMonth();
  const firstDay = new Date(yr, mo, 1).getDay();
  const daysInMo = new Date(yr, mo + 1, 0).getDate();
  const cells    = Math.ceil((firstDay + daysInMo) / 7) * 7;
  const byDate   = {};
  rows.forEach((t) => { const k = t.dueDate || t.startDate; if (k) { if (!byDate[k]) byDate[k] = []; byDate[k].push(t); } });
  const todayStr = new Date().toISOString().slice(0, 10);
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
        <button onClick={() => setCur(new Date(yr, mo - 1, 1))} className="text-gray-400 hover:text-gray-600 text-xl px-1">‹</button>
        <span className="text-[13px] font-semibold text-navy">{cur.toLocaleDateString("en-PH", { month: "long", year: "numeric" })}</span>
        <button onClick={() => setCur(new Date(yr, mo + 1, 1))} className="text-gray-400 hover:text-gray-600 text-xl px-1">›</button>
      </div>
      <div className="grid grid-cols-7 border-b border-gray-100">
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d) => (
          <div key={d} className="text-center py-1.5 text-[10px] text-gray-400 uppercase tracking-wide">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: cells }, (_, i) => {
          const n = i - firstDay + 1; const valid = n >= 1 && n <= daysInMo;
          const ds = valid ? `${yr}-${String(mo+1).padStart(2,"0")}-${String(n).padStart(2,"0")}` : null;
          const ts = ds ? (byDate[ds] || []) : [];
          const isToday = ds === todayStr;
          return (
            <div key={i} className={`min-h-[68px] border-b border-r border-gray-100 p-1 ${!valid ? "bg-gray-50/40" : ""}`}>
              {valid && <>
                <div className={`text-[11px] font-medium w-5 h-5 flex items-center justify-center rounded-full mb-0.5 ${isToday ? "bg-navy text-white" : "text-gray-500"}`}>{n}</div>
                {ts.slice(0, 3).map((t) => <div key={t.id} className="text-[10px] bg-teal-100 text-teal-800 rounded px-1 py-0.5 mb-0.5 truncate" title={t.name}>{t.name}</div>)}
                {ts.length > 3 && <div className="text-[10px] text-gray-400">+{ts.length - 3}</div>}
              </>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Card View ─────────────────────────────────────────────────────────────────
const KANBAN_COLS = ["Not Started", "In Progress", "Blocked", "Done"];
function CardView({ rows, projects, users }) {
  const nameFirst = (uid) => users.find((u) => u.id === uid)?.name?.split(" ")[0] || "—";
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {KANBAN_COLS.map((status) => {
        const ts = rows.filter((t) => (t.status || "Not Started") === status);
        return (
          <div key={status} className="shrink-0 w-56">
            <div className="flex items-center gap-1.5 mb-2">
              <StatusPill status={status} />
              <span className="text-[11px] text-gray-400">{ts.length}</span>
            </div>
            <div className="space-y-2">
              {ts.map((t) => (
                <div key={`${t.projectId}-${t.id}`} className="bg-white rounded-lg border border-gray-200 shadow-sm p-2.5 hover:shadow-md transition cursor-default">
                  <div className="text-[12px] font-medium text-navy mb-1 leading-tight">{t.name}</div>
                  <Link to={`/projects/${t.projectId}`} className="text-[11px] text-teal-700 hover:underline block mb-1 truncate">{projects[t.projectId]?.name}</Link>
                  <div className="flex items-center justify-between text-[10px] text-gray-400">
                    <span>{t.dueDate || "No due date"}</span>
                    {t.assigneeId && <span className="bg-gray-100 rounded-full px-1.5 py-0.5">{nameFirst(t.assigneeId)}</span>}
                  </div>
                </div>
              ))}
              {ts.length === 0 && <div className="text-[11px] text-gray-300 italic p-2">No tasks</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── List View ─────────────────────────────────────────────────────────────────
function ListView({ rows, projects, users, view, colWidths, onWidthChange, onSortChange, onColReorder }) {
  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";
  const [dragKey, setDragKey] = useState(null);
  const [dropKey, setDropKey] = useState(null);
  const [resizing, setResizing] = useState(null);

  const visibleCols = (view.colOrder || DEFAULT_COL_ORDER)
    .filter((k) => COL_MAP[k] && !(view.hiddenCols || []).includes(k));

  const getWidth = (key) => colWidths[key] ?? COL_MAP[key]?.defaultWidth ?? 120;

  // Resize events
  useEffect(() => {
    if (!resizing) return;
    const onMove = (e) => {
      const diff = e.clientX - resizing.startX;
      const w = Math.max(50, resizing.startW + diff);
      onWidthChange(resizing.key, w);
    };
    const onUp = () => setResizing(null);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [resizing]);

  // Group rows
  const getGroupKey = (t) => {
    if (!view.groupBy) return null;
    if (view.groupBy === "project")   return projects[t.projectId]?.name || "No Project";
    if (view.groupBy === "assignee")  return nameFor(t.assigneeId) || "Unassigned";
    if (view.groupBy === "owner")     return nameFor(projects[t.projectId]?.ownerId) || "—";
    if (view.groupBy === "status")    return t.status || "Not Started";
    if (view.groupBy === "startDate") return t.startDate ? isoWeekStart(t.startDate) : "No Date";
    return "—";
  };

  let displayRows = [...rows];
  if (view.sortCol) {
    displayRows.sort((a, b) => {
      const va = a[view.sortCol] ?? ""; const vb = b[view.sortCol] ?? "";
      return view.sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    });
  }

  // Build render list with group headers
  const renderItems = [];
  if (view.groupBy) {
    const grouped = {};
    const order = [];
    displayRows.forEach((t) => {
      const k = getGroupKey(t);
      if (!grouped[k]) { grouped[k] = []; order.push(k); }
      grouped[k].push(t);
    });
    order.forEach((k) => {
      renderItems.push({ type: "group", key: k, count: grouped[k].length });
      grouped[k].forEach((t) => renderItems.push({ type: "row", task: t }));
    });
  } else {
    displayRows.forEach((t) => renderItems.push({ type: "row", task: t }));
  }

  const cellVal = (t, key) => {
    if (key === "name")        return <span className="font-medium text-navy">{t.name}</span>;
    if (key === "project")     return <Link to={`/projects/${t.projectId}`} className="text-teal-700 hover:underline">{projects[t.projectId]?.name || "—"}</Link>;
    if (key === "phase")       return <span className="text-gray-500 text-[11px]">{t.phase || "—"}</span>;
    if (key === "assignee")    return <span className="text-gray-600">{t.assigneeId ? nameFor(t.assigneeId) : <span className="text-gray-300">—</span>}</span>;
    if (key === "status")      return <StatusPill status={t.status} />;
    if (key === "startDate")   return <span className="text-gray-500 font-mono text-[11px]">{t.startDate ? fmtDate(t.startDate) : "—"}</span>;
    if (key === "dueDate")     return <span className="text-gray-500 font-mono text-[11px]">{t.dueDate ? fmtDate(t.dueDate) : "—"}</span>;
    if (key === "estHours")    return <span className="text-gray-600">{t.estimatedHours ?? "—"}</span>;
    if (key === "actualHours") return <span className="text-gray-600">{t.actualHours ?? "—"}</span>;
    return "—";
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 overflow-hidden overflow-x-auto">
      <table className="w-full text-[12px] border-collapse" style={{ tableLayout: "fixed" }}>
        <colgroup>
          {visibleCols.map((k) => <col key={k} style={{ width: getWidth(k) }} />)}
        </colgroup>
        <thead>
          <tr className="bg-slate-50 border-b border-gray-200">
            {visibleCols.map((k) => {
              const col = COL_MAP[k];
              const isSorted = view.sortCol === k;
              return (
                <th key={k} className="relative px-2 py-1.5 text-left text-[10px] text-gray-400 uppercase tracking-wide font-medium select-none group cursor-pointer whitespace-nowrap overflow-hidden"
                  draggable={!col.fixed}
                  onDragStart={() => !col.fixed && setDragKey(k)}
                  onDragOver={(e) => { e.preventDefault(); setDropKey(k); }}
                  onDrop={() => { if (dragKey && dragKey !== k) { onColReorder(dragKey, k); } setDragKey(null); setDropKey(null); }}
                  onDragEnd={() => { setDragKey(null); setDropKey(null); }}
                  onClick={() => !col.fixed && onSortChange(k)}
                  style={{ background: dropKey === k ? "rgba(20,184,166,0.08)" : undefined }}
                >
                  <span>{col.label}</span>
                  {isSorted && <span className="ml-0.5 text-teal">{view.sortDir === "asc" ? "↑" : "↓"}</span>}
                  {/* Resize handle */}
                  {!col.fixed && (
                    <span
                      className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize opacity-0 group-hover:opacity-100 flex items-center justify-center"
                      onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); setResizing({ key: k, startX: e.clientX, startW: getWidth(k) }); }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="w-px h-3 bg-gray-300" />
                    </span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {renderItems.map((item, idx) => {
            if (item.type === "group") {
              return (
                <tr key={`g-${item.key}`} className="bg-slate-50/80 border-t border-b border-gray-200">
                  <td colSpan={visibleCols.length} className="px-3 py-1.5">
                    <span className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{item.key}</span>
                    <span className="ml-2 text-[10px] text-gray-400">{item.count}</span>
                  </td>
                </tr>
              );
            }
            const t = item.task;
            return (
              <tr key={`${t.projectId}-${t.id}`} className="border-t border-gray-100 hover:bg-slate-50/60 transition-colors">
                {visibleCols.map((k) => (
                  <td key={k} className={`px-2 py-1.5 overflow-hidden whitespace-nowrap ${COL_MAP[k]?.align === "right" ? "text-right" : ""}`}>
                    {cellVal(t, k)}
                  </td>
                ))}
              </tr>
            );
          })}
          {renderItems.length === 0 && (
            <tr><td colSpan={visibleCols.length} className="px-4 py-8 text-center text-[12px] text-gray-400">No tasks to show.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const VIEW_ICONS = { list: "☰", gantt: "▬", calendar: "▦", card: "⊞" };
const GROUP_OPTIONS = [
  { value: "",          label: "No grouping" },
  { value: "project",   label: "By Project" },
  { value: "assignee",  label: "By Assignee" },
  { value: "owner",     label: "By Owner" },
  { value: "status",    label: "By Status" },
  { value: "startDate", label: "By Start Week" },
];

export default function TasksPage() {
  const { user, profile } = useAuth();

  // ── Data ──
  const [tasks,    setTasks]    = useState([]);
  const [projects, setProjects] = useState({});
  const [users,    setUsers]    = useState([]);

  // ── View management ──
  const [savedViews,       setSavedViews]       = useState(loadViews);
  const [activeViewId,     setActiveViewId]     = useState(() => localStorage.getItem(LS_ACTIVE) || "default");
  const [showNewViewInput, setShowNewViewInput] = useState(false);
  const [newViewName,      setNewViewName]      = useState("");
  const [renamingId,       setRenamingId]       = useState(null);
  const [renameVal,        setRenameVal]        = useState("");
  const [showFieldPicker,  setShowFieldPicker]  = useState(false);
  const [colWidths,        setColWidths]        = useState(loadWidths);

  // ── Data loading ──
  useEffect(() => {
    const u1 = onSnapshot(collectionGroup(db, "tasks"), (snap) =>
      setTasks(snap.docs.map((d) => ({ id: d.id, projectId: d.ref.parent.parent.id, ...d.data() }))));
    const u2 = onSnapshot(collection(db, "projects"), (snap) => {
      const m = {}; snap.docs.forEach((d) => (m[d.id] = { id: d.id, ...d.data() })); setProjects(m);
    });
    const u3 = onSnapshot(collection(db, "users"), (snap) =>
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => { u1(); u2(); u3(); };
  }, []);

  // ── Active view object ──
  const activeView = (activeViewId === "default")
    ? DEFAULT_VIEW
    : (savedViews.find((v) => v.id === activeViewId) || DEFAULT_VIEW);

  const updateView = (patch) => {
    if (activeViewId === "default") return; // default view is immutable
    const updated = savedViews.map((v) => v.id === activeViewId ? { ...v, ...patch } : v);
    setSavedViews(updated);
    localStorage.setItem(LS_VIEWS, JSON.stringify(updated));
  };

  // ── Visible tasks (invite-only) ──
  const visibleTasks = tasks.filter((t) => {
    const p = projects[t.projectId];
    if (!p) return false;
    if (profile?.role === "Admin") return true;
    return p.memberIds?.includes(user?.uid);
  });

  // ── Filter ──
  const filteredTasks = activeView.filterAssignee === "all" ? visibleTasks
    : activeView.filterAssignee === "unassigned" ? visibleTasks.filter((t) => !t.assigneeId)
    : visibleTasks.filter((t) => t.assigneeId === activeView.filterAssignee);

  // ── View actions ──
  const persistActiveView = (id) => { setActiveViewId(id); localStorage.setItem(LS_ACTIVE, id); };

  const addView = () => {
    const name = newViewName.trim() || "New View";
    const newView = { ...activeView, id: ruid(), name };
    const updated = [...savedViews, newView];
    setSavedViews(updated);
    localStorage.setItem(LS_VIEWS, JSON.stringify(updated));
    persistActiveView(newView.id);
    setNewViewName("");
    setShowNewViewInput(false);
  };

  const deleteView = (id) => {
    const updated = savedViews.filter((v) => v.id !== id);
    setSavedViews(updated);
    localStorage.setItem(LS_VIEWS, JSON.stringify(updated));
    if (activeViewId === id) persistActiveView("default");
  };

  const handleColReorder = (fromKey, toKey) => {
    const order = [...(activeView.colOrder || DEFAULT_COL_ORDER)];
    const fi = order.indexOf(fromKey); const ti = order.indexOf(toKey);
    if (fi < 0 || ti < 0) return;
    order.splice(fi, 1); order.splice(ti, 0, fromKey);
    updateView({ colOrder: order });
  };

  const handleWidthChange = (key, w) => {
    const next = { ...colWidths, [key]: w };
    setColWidths(next);
    localStorage.setItem(LS_WIDTHS, JSON.stringify(next));
  };

  const handleSortChange = (key) => {
    if (key === COL_MAP["name"]?.key) return; // name not sortable
    if (activeView.sortCol === key) updateView({ sortDir: activeView.sortDir === "asc" ? "desc" : "asc" });
    else updateView({ sortCol: key, sortDir: "asc" });
  };

  const toggleCol = (key) => {
    if (COL_MAP[key]?.fixed) return;
    const hidden = activeView.hiddenCols || [];
    updateView({ hiddenCols: hidden.includes(key) ? hidden.filter((k) => k !== key) : [...hidden, key] });
  };

  return (
    <div className="flex gap-4 min-h-0">
      {/* ── Views sidebar ── */}
      <div className="w-44 shrink-0">
        <div className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1.5 px-0.5">Views</div>
        {/* Default view */}
        <button
          className={`w-full text-left px-2 py-1.5 rounded text-[12px] mb-0.5 ${activeViewId === "default" ? "bg-navy text-white" : "text-gray-600 hover:bg-slate-100"}`}
          onClick={() => persistActiveView("default")}
        >
          {VIEW_ICONS.list} All Tasks
        </button>
        {/* Saved views */}
        {savedViews.map((v) => (
          <div key={v.id} className="group flex items-center gap-1 mb-0.5">
            {renamingId === v.id ? (
              <input autoFocus value={renameVal}
                onChange={(e) => setRenameVal(e.target.value)}
                onBlur={() => {
                  if (renameVal.trim()) {
                    const updated = savedViews.map((sv) => sv.id === v.id ? { ...sv, name: renameVal.trim() } : sv);
                    setSavedViews(updated); localStorage.setItem(LS_VIEWS, JSON.stringify(updated));
                  }
                  setRenamingId(null);
                }}
                onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setRenamingId(null); }}
                className="flex-1 text-[12px] border border-teal rounded px-1.5 py-1 focus:outline-none"
              />
            ) : (
              <button
                className={`flex-1 text-left px-2 py-1.5 rounded text-[12px] ${activeViewId === v.id ? "bg-navy text-white" : "text-gray-600 hover:bg-slate-100"}`}
                onClick={() => persistActiveView(v.id)}
                onDoubleClick={() => { setRenamingId(v.id); setRenameVal(v.name); }}
              >
                {VIEW_ICONS[v.type] || VIEW_ICONS.list} {v.name}
              </button>
            )}
            <button onClick={() => deleteView(v.id)} className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-300 hover:text-red-400 shrink-0 transition px-1">✕</button>
          </div>
        ))}
        {/* New view */}
        {showNewViewInput ? (
          <div className="mt-1">
            <input autoFocus placeholder="View name…" value={newViewName}
              onChange={(e) => setNewViewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addView(); if (e.key === "Escape") setShowNewViewInput(false); }}
              className="w-full text-[12px] border border-gray-300 rounded px-2 py-1 mb-1 focus:outline-none focus:ring-1 focus:ring-teal"
            />
            <div className="flex gap-1">
              <button onClick={addView} className="flex-1 text-[11px] bg-navy text-white rounded px-2 py-1">Save</button>
              <button onClick={() => setShowNewViewInput(false)} className="text-[11px] text-gray-400 px-1">✕</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setShowNewViewInput(true)} className="w-full text-left px-2 py-1.5 text-[12px] text-gray-400 hover:text-gray-600 hover:bg-slate-100 rounded mt-1">
            + New view
          </button>
        )}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div>
            <h2 className="text-xl font-bold font-heading text-navy leading-none">{activeView.name}</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">{filteredTasks.length} task{filteredTasks.length !== 1 ? "s" : ""}</p>
          </div>
          {/* Toolbar */}
          <div className="flex items-center gap-1.5">
            {/* Assignee filter */}
            <select value={activeView.filterAssignee || "all"}
              onChange={(e) => updateView({ filterAssignee: e.target.value })}
              className="border border-gray-200 rounded-md px-2 py-1 text-[12px] text-gray-600 focus:outline-none focus:ring-1 focus:ring-teal"
            >
              <option value="all">All assignees</option>
              <option value="unassigned">Unassigned</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>

            {/* Group by */}
            <select value={activeView.groupBy || ""}
              onChange={(e) => updateView({ groupBy: e.target.value || null })}
              className="border border-gray-200 rounded-md px-2 py-1 text-[12px] text-gray-600 focus:outline-none focus:ring-1 focus:ring-teal"
            >
              {GROUP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {/* Fields picker (list view only) */}
            {activeView.type === "list" && activeViewId !== "default" && (
              <div className="relative">
                <button onClick={() => setShowFieldPicker(!showFieldPicker)}
                  className="border border-gray-200 rounded-md px-2 py-1 text-[12px] text-gray-600 hover:bg-slate-50">
                  Fields
                </button>
                {showFieldPicker && (
                  <div className="absolute right-0 top-8 z-20 bg-white shadow-lg rounded-lg border border-gray-200 p-2 w-44">
                    <div className="text-[10px] text-gray-400 uppercase tracking-wide mb-1.5 px-1">Show / hide columns</div>
                    {ALL_COLS.filter((c) => !c.fixed).map((c) => (
                      <label key={c.key} className="flex items-center gap-2 px-1 py-1 rounded hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={!(activeView.hiddenCols || []).includes(c.key)}
                          onChange={() => toggleCol(c.key)} className="accent-teal" />
                        <span className="text-[12px] text-gray-700">{c.label}</span>
                      </label>
                    ))}
                    <button onClick={() => setShowFieldPicker(false)} className="w-full mt-2 text-[11px] text-gray-400 hover:text-gray-600">Done</button>
                  </div>
                )}
              </div>
            )}

            {/* View type switcher */}
            <div className="flex rounded-md border border-gray-200 overflow-hidden">
              {Object.entries(VIEW_ICONS).map(([type, icon]) => (
                <button key={type}
                  onClick={() => updateView({ type })}
                  title={type}
                  className={`px-2.5 py-1 text-[13px] transition ${activeView.type === type ? "bg-navy text-white" : "text-gray-400 hover:bg-slate-50"}`}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* View content */}
        {activeView.type === "list" && (
          <ListView
            rows={filteredTasks}
            projects={projects}
            users={users}
            view={activeView}
            colWidths={colWidths}
            onWidthChange={handleWidthChange}
            onSortChange={handleSortChange}
            onColReorder={handleColReorder}
          />
        )}
        {activeView.type === "gantt"    && <GanttView    rows={filteredTasks} projects={projects} users={users} />}
        {activeView.type === "calendar" && <CalendarView rows={filteredTasks} />}
        {activeView.type === "card"     && <CardView     rows={filteredTasks} projects={projects} users={users} />}

        {activeViewId === "default" && activeView.type === "list" && (
          <p className="text-[11px] text-gray-400 mt-2">Tip: Click "+ New view" to save a customized view with its own grouping, sort, and columns.</p>
        )}
      </div>
    </div>
  );
}
