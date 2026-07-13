import { useEffect, useState, useMemo, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  collection, collectionGroup, onSnapshot, query, where, addDoc,
  deleteDoc, doc, updateDoc, serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { computeHealth, STATUS_STYLES, migrateLegacyStatus } from "../../../lib/health";
import { computeRollups } from "../../../lib/completion";

// ── Planning stage logic ──────────────────────────────────────────────────────
function getPlanningStage(project, health) {
  if (project.planningStatus === "Draft / Intake")   return "Draft / Intake";
  if (project.planningStatus === "WBS Pending")      return "WBS Pending";
  if (project.planningStatus === "Resource Check")   return "Resource Check";
  if (project.baselineStatus  === "Pending Approval") return "Pending Approval";
  const s = project.status || "";
  if (s === "Done" || s === "Canceled")              return "Done";
  if (s === "On Hold")                               return "On Hold";
  if (s === "Active" && (health?.label === "At Risk" || health?.label === "Behind Schedule")) return "At Risk / Behind";
  if (s === "Active")                                return "Active";
  return "Draft / Intake";
}

const STAGE_CONFIG = {
  "Draft / Intake":   { color: "bg-blue-500",   light: "bg-blue-50",   text: "text-blue-700",   border: "border-blue-500",   desc: "New requests awaiting setup"         },
  "WBS Pending":      { color: "bg-purple-500",  light: "bg-purple-50", text: "text-purple-700", border: "border-purple-500", desc: "Hours and roles not confirmed"       },
  "Resource Check":   { color: "bg-orange-500",  light: "bg-orange-50", text: "text-orange-700", border: "border-orange-500", desc: "Awaiting capacity validation"        },
  "Pending Approval": { color: "bg-yellow-500",  light: "bg-yellow-50", text: "text-yellow-700", border: "border-yellow-500", desc: "Ready for baseline approval"         },
  "Active":           { color: "bg-emerald-500", light: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-500",desc: "Approved and in progress"            },
  "At Risk / Behind": { color: "bg-red-500",     light: "bg-red-50",    text: "text-red-700",    border: "border-red-500",    desc: "Needs attention or action"          },
  "Done":             { color: "bg-gray-400",    light: "bg-gray-50",   text: "text-gray-600",   border: "border-gray-400",   desc: "Completed projects"                 },
};

const STAGE_ICONS = {
  "Draft / Intake":   <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />,
  "WBS Pending":      <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />,
  "Resource Check":   <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,
  "Pending Approval": <><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>,
  "Active":           <><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></>,
  "At Risk / Behind": <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
  "Done":             <><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>,
};

const NEXT_ACTION = {
  "Draft / Intake":   "Confirm WBS hours",
  "WBS Pending":      "Assign required roles",
  "Resource Check":   "Review capacity gap",
  "Pending Approval": "Approve baseline",
  "Active":           "Continue execution",
  "At Risk / Behind": "Reforecast timeline",
  "Done":             "View summary",
  "On Hold":          "Review status",
};

const PRIORITY_STYLES = {
  High:   "bg-red-100 text-red-700",
  Medium: "bg-amber-100 text-amber-700",
  Low:    "bg-emerald-100 text-emerald-700",
};

const DEV_LEVEL_STYLES = {
  "Level 1": "bg-green-100 text-green-700",
  "Level 2": "bg-amber-100 text-amber-700",
  "Level 3": "bg-red-100 text-red-700",
};

const STAGE_TABS = [
  { id: "all",        label: "All Projects" },
  { id: "intake",     label: "Intake & Planning",  stages: ["Draft / Intake","WBS Pending","Resource Check"] },
  { id: "active",     label: "Active Execution",   stages: ["Pending Approval","Active"] },
  { id: "risks",      label: "Resource Risks",     stages: ["At Risk / Behind"] },
  { id: "completed",  label: "Completed",          stages: ["Done"] },
];

// ── Avatar ────────────────────────────────────────────────────────────────────
function Avatar({ name }) {
  const initials = name?.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";
  return (
    <div className="w-7 h-7 rounded-full bg-teal-500 flex items-center justify-center text-[10px] font-bold text-white shrink-0">
      {initials}
    </div>
  );
}

// ── Stage badge ───────────────────────────────────────────────────────────────
function StageBadge({ stage }) {
  const cfg = STAGE_CONFIG[stage] || STAGE_CONFIG["Draft / Intake"];
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.light} ${cfg.text}`}>
      {stage}
    </span>
  );
}

// ── Variance chip ─────────────────────────────────────────────────────────────
function VarianceChip({ target, forecast }) {
  if (!target || !forecast) return <span className="text-gray-300">—</span>;
  const tDate = new Date(target + "T00:00:00");
  const fDate = new Date(forecast + "T00:00:00");
  const days = Math.round((fDate - tDate) / 86400000);
  if (days === 0) return <span className="text-emerald-600 font-medium text-[12px]">0 days</span>;
  const cls = days > 0 ? "text-red-600" : "text-emerald-600";
  return <span className={`font-semibold text-[12px] ${cls}`}>{days > 0 ? "+" : ""}{days} days</span>;
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ProjectsPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();

  const [projects,        setProjects]        = useState([]);
  const [users,           setUsers]           = useState([]);
  const [tasksByProject,  setTasksByProject]  = useState({});
  const [activeTab,       setActiveTab]       = useState("all");
  const [search,          setSearch]          = useState("");
  const [filters,         setFilters]         = useState({ workType: "all", owner: "all", priority: "all", stage: "all", health: "all" });
  const [page,            setPage]            = useState(1);
  const PER_PAGE = 10;

  // ── Data loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubUsers = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });

    const unsubTasks = onSnapshot(collectionGroup(db, "tasks"), (snap) => {
      const grouped = {};
      snap.docs.forEach((d) => {
        const pid = d.ref.parent.parent.id;
        (grouped[pid] ||= []).push({ id: d.id, ...d.data() });
      });
      setTasksByProject(grouped);
    });

    const projRef = collection(db, "projects");
    const isTeamViewer = profile?.role === "Admin" || profile?.projectScope === "team";

    if (isTeamViewer) {
      const unsubProjects = onSnapshot(projRef, (snap) => {
        setProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      });
      return () => { unsubUsers(); unsubTasks(); unsubProjects(); };
    }

    // Default: own projects + assigned (two queries merged to handle stale memberIds)
    const projectMap = new Map();
    const merge = (snap) => {
      snap.docs.forEach((d) => projectMap.set(d.id, { id: d.id, ...d.data() }));
      setProjects([...projectMap.values()]);
    };
    const q1 = query(projRef, where("memberIds", "array-contains", user.uid));
    const q2 = query(projRef, where("ownerId", "==", user.uid));
    const unsubQ1 = onSnapshot(q1, merge);
    const unsubQ2 = onSnapshot(q2, merge);
    return () => { unsubUsers(); unsubTasks(); unsubQ1(); unsubQ2(); };
  }, [user, profile]);

  const nameFor = (uid) => users.find((u) => u.id === uid)?.name || "—";
  const today   = new Date().toISOString().split("T")[0];

  // ── Row computation ───────────────────────────────────────────────────────
  const rows = useMemo(() => {
    return projects.map((p) => {
      const allTasks = tasksByProject[p.id] || [];
      const { projectCompletion } = computeRollups(allTasks);
      const health   = computeHealth(p, projectCompletion);
      const stage    = getPlanningStage(p, health);
      const wbsEffort = allTasks.filter(t => !t.parentTaskId).reduce((s, t) => s + (t.estimatedHours || 0), 0);
      const forecastEnd = p.approvedRevisedEndDate || p.baselineEndDate || null;
      return { p, health, stage, wbsEffort, forecastEnd };
    });
  }, [projects, tasksByProject]);

  // ── Counts for pipeline cards ─────────────────────────────────────────────
  const stageCounts = useMemo(() => {
    const counts = {};
    rows.forEach(({ stage }) => {
      counts[stage] = (counts[stage] || 0) + 1;
    });
    return counts;
  }, [rows]);

  // ── Filtering ─────────────────────────────────────────────────────────────
  const filteredRows = useMemo(() => {
    let result = rows;

    // Tab filter
    if (activeTab !== "all") {
      const tab = STAGE_TABS.find(t => t.id === activeTab);
      if (tab?.stages) result = result.filter(r => tab.stages.includes(r.stage));
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r =>
        r.p.name?.toLowerCase().includes(q) ||
        r.p.projectCode?.toLowerCase().includes(q) ||
        r.p.ticketNumber?.toLowerCase().includes(q)
      );
    }

    // Dropdowns
    if (filters.priority !== "all") result = result.filter(r => r.p.priority === filters.priority);
    if (filters.stage    !== "all") result = result.filter(r => r.stage === filters.stage);
    if (filters.health   !== "all") result = result.filter(r => r.health.label === filters.health);
    if (filters.owner    !== "all") result = result.filter(r => r.p.ownerId === filters.owner);
    if (filters.workType !== "all") result = result.filter(r => r.p.workTypeName?.includes(filters.workType));

    return result;
  }, [rows, activeTab, search, filters]);

  // ── Pagination ────────────────────────────────────────────────────────────
  const totalPages   = Math.max(1, Math.ceil(filteredRows.length / PER_PAGE));
  const pagedRows    = filteredRows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const uniqueOwners = [...new Map(users.map(u => [u.id, u])).values()];
  const uniqueTypes  = [...new Set(rows.map(r => r.p.workTypeName).filter(Boolean))];

  // Reset page when filter changes
  useEffect(() => setPage(1), [activeTab, search, filters]);

  const hasFilters = search || Object.values(filters).some(v => v !== "all");

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold font-heading text-navy">Projects</h2>
          <p className="text-[13px] text-gray-500 mt-0.5">
            Track all projects from intake to delivery. Monitor planning stages, resource readiness, and delivery health.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="flex items-center gap-1.5 border border-gray-300 bg-white rounded-lg px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-50 transition">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
            Export
          </button>
          <Link to="/projects/new"
            className="flex items-center gap-1.5 bg-navy text-white rounded-lg px-4 py-2 text-[13px] font-semibold hover:bg-navy-light transition">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            New Project
          </Link>
        </div>
      </div>

      {/* Planning pipeline cards */}
      <div className="grid grid-cols-7 gap-3 mb-5">
        {Object.entries(STAGE_CONFIG).map(([stage, cfg]) => (
          <div key={stage}
            onClick={() => setFilters(f => ({ ...f, stage: f.stage === stage ? "all" : stage }))}
            className={`bg-white rounded-xl border border-gray-200 shadow-sm p-3.5 cursor-pointer hover:shadow-md transition-all relative overflow-hidden ${filters.stage === stage ? "ring-2 ring-offset-1 " + cfg.border : ""}`}
          >
            {/* Colored icon */}
            <div className={`w-9 h-9 rounded-full ${cfg.color} flex items-center justify-center mb-2.5`}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {STAGE_ICONS[stage]}
              </svg>
            </div>
            <div className="text-2xl font-bold font-heading text-navy mb-0.5">{stageCounts[stage] || 0}</div>
            <div className="text-[11px] font-semibold text-gray-700 leading-tight mb-1">{stage}</div>
            <div className="text-[10px] text-gray-400 leading-snug">{cfg.desc}</div>
            {/* Bottom accent bar */}
            <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${cfg.color}`} />
          </div>
        ))}
      </div>

      {/* Tab navigation */}
      <div className="flex items-center justify-between border-b border-gray-200 mb-4">
        <div className="flex items-center gap-0">
          {STAGE_TABS.map((tab) => (
            <button key={tab.id} onClick={() => { setActiveTab(tab.id); setFilters(f => ({ ...f, stage: "all" })); }}
              className={`px-4 py-2.5 text-[13px] font-medium border-b-2 transition whitespace-nowrap -mb-px ${
                activeTab === tab.id ? "border-teal text-teal-600" : "border-transparent text-gray-500 hover:text-gray-700"
              }`}>
              {tab.label}
              {tab.id !== "all" && (
                <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                  activeTab === tab.id ? "bg-teal-100 text-teal-700" : "bg-gray-100 text-gray-500"
                }`}>
                  {tab.stages ? rows.filter(r => tab.stages.includes(r.stage)).length : rows.length}
                </span>
              )}
            </button>
          ))}
        </div>
        {/* Search + Columns */}
        <div className="flex items-center gap-2 pb-2">
          <div className="relative">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2" className="absolute left-3 top-1/2 -translate-y-1/2">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-[12px] w-48 focus:outline-none focus:ring-2 focus:ring-teal focus:border-transparent"
            />
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {[
          { key: "workType", label: "Work Type",     options: uniqueTypes.map(t => ({ value: t, label: t.length > 20 ? t.slice(0, 20) + "…" : t })) },
          { key: "owner",    label: "Owner",         options: uniqueOwners.map(u => ({ value: u.id, label: u.name })) },
          { key: "priority", label: "Priority",      options: ["High","Medium","Low"].map(v => ({ value: v, label: v })) },
          { key: "stage",    label: "Planning Stage",options: Object.keys(STAGE_CONFIG).map(v => ({ value: v, label: v })) },
          { key: "health",   label: "Health",        options: ["On Track","At Risk","Behind Schedule","On Hold","Scoping","Not Started"].map(v => ({ value: v, label: v })) },
        ].map(({ key, label, options }) => (
          <select key={key} value={filters[key]}
            onChange={(e) => setFilters(f => ({ ...f, [key]: e.target.value }))}
            className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px] text-gray-700 bg-white focus:outline-none focus:ring-1 focus:ring-teal"
          >
            <option value="all">{label}: All</option>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        ))}
        {hasFilters && (
          <button onClick={() => { setSearch(""); setFilters({ workType: "all", owner: "all", priority: "all", stage: "all", health: "all" }); setActiveTab("all"); }}
            className="text-[12px] text-teal-600 hover:underline flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {[
                { label: "Project Name", w: "w-56" },
                { label: "Planning Stage", w: "w-32" },
                { label: "Priority", w: "w-20" },
                { label: "Work Type", w: "w-36" },
                { label: "Dev. Level", w: "w-24" },
                { label: "Owner", w: "w-32" },
                { label: "WBS Effort", w: "w-24" },
                { label: "Resource Status", w: "w-28" },
                { label: "Requested Launch", w: "w-32" },
                { label: "Forecast End", w: "w-28" },
                { label: "Variance", w: "w-24" },
                { label: "Health", w: "w-24" },
                { label: "Next Action", w: "" },
              ].map(({ label, w }) => (
                <th key={label} className={`text-left px-3 py-3 text-[10px] font-semibold text-gray-500 uppercase tracking-wide ${w}`}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pagedRows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-12 text-center text-gray-400">
                  {rows.length === 0 ? "No projects yet. Create your first project to get started." : "No projects match your filters."}
                </td>
              </tr>
            ) : pagedRows.map(({ p, health, stage, wbsEffort, forecastEnd }) => {
              const stageCfg = STAGE_CONFIG[stage] || STAGE_CONFIG["Draft / Intake"];
              const owner    = users.find(u => u.id === p.ownerId);
              return (
                <tr key={p.id} className="hover:bg-gray-50/60 transition-colors">
                  {/* Project Name */}
                  <td className="px-3 py-3">
                    <div className="flex items-start gap-2.5">
                      <div className={`w-6 h-6 rounded-full ${stageCfg.color} flex items-center justify-center shrink-0 mt-0.5`}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          {STAGE_ICONS[stage]}
                        </svg>
                      </div>
                      <div>
                        <Link to={`/projects/${p.id}`} className="font-semibold text-navy hover:text-teal-600 hover:underline block leading-tight">
                          {p.name}
                        </Link>
                        {p.projectCode && <div className="text-[10px] text-gray-400 mt-0.5">{p.projectCode}</div>}
                        {p.ticketNumber && <div className="text-[10px] text-gray-400">{p.ticketNumber}</div>}
                      </div>
                    </div>
                  </td>
                  {/* Planning Stage */}
                  <td className="px-3 py-3"><StageBadge stage={stage} /></td>
                  {/* Priority */}
                  <td className="px-3 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_STYLES[p.priority] || "bg-gray-100 text-gray-500"}`}>
                      {p.priority}
                    </span>
                  </td>
                  {/* Work Type */}
                  <td className="px-3 py-3 text-gray-600 max-w-[144px] truncate" title={p.workTypeName}>{p.workTypeName || "—"}</td>
                  {/* Dev Level */}
                  <td className="px-3 py-3">
                    {p.developmentType ? (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${DEV_LEVEL_STYLES[p.developmentType] || "bg-gray-100 text-gray-500"}`}>
                        {p.developmentType.replace("Level ", "L")}
                      </span>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  {/* Owner */}
                  <td className="px-3 py-3">
                    {owner ? (
                      <div className="flex items-center gap-1.5">
                        <Avatar name={owner.name} />
                        <span className="text-gray-700 text-[12px] truncate max-w-[80px]" title={owner.name}>
                          {owner.name?.split(" ").map((n, i) => i === 0 ? n : n[0] + ".").join(" ")}
                        </span>
                      </div>
                    ) : <span className="text-gray-300">—</span>}
                  </td>
                  {/* WBS Effort */}
                  <td className="px-3 py-3">
                    {wbsEffort > 0
                      ? <span className="font-medium text-gray-700">{wbsEffort} hrs</span>
                      : <span className="text-[11px] text-gray-400 italic">Not set</span>}
                  </td>
                  {/* Resource Status — derived from planningStatus + baselineStatus */}
                  <td className="px-3 py-3">
                    {(() => {
                      const ps = p.planningStatus || "Draft / Intake";
                      const bs = p.baselineStatus  || "Not Submitted";
                      const st = p.status          || "";
                      let label, cls;
                      if (st === "Done") {
                        label = "Complete";      cls = "bg-gray-100 text-gray-500";
                      } else if (bs === "Approved") {
                        label = "Approved";      cls = "bg-emerald-100 text-emerald-700";
                      } else if (bs === "Pending Approval") {
                        label = "Awaiting Approval"; cls = "bg-yellow-100 text-yellow-700";
                      } else if (bs === "Rejected") {
                        label = "Rejected";      cls = "bg-red-100 text-red-700";
                      } else if (ps === "Resource Check") {
                        label = "Resources Set"; cls = "bg-orange-100 text-orange-700";
                      } else if (ps === "WBS Pending") {
                        label = "WBS Done";      cls = "bg-blue-100 text-blue-700";
                      } else {
                        label = "Not Started";   cls = "bg-gray-100 text-gray-400";
                      }
                      return (
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
                          {label}
                        </span>
                      );
                    })()}
                  </td>
                  {/* Requested Launch */}
                  <td className="px-3 py-3 text-gray-600">{p.targetLaunchDate || <span className="text-gray-300">—</span>}</td>
                  {/* Forecast End */}
                  <td className="px-3 py-3 text-gray-600">{forecastEnd || <span className="text-gray-300">—</span>}</td>
                  {/* Variance */}
                  <td className="px-3 py-3">
                    <VarianceChip target={p.targetLaunchDate} forecast={forecastEnd} />
                  </td>
                  {/* Health */}
                  <td className="px-3 py-3">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${health.style}`}>
                      {health.label}
                    </span>
                  </td>
                  {/* Next Action */}
                  <td className="px-3 py-3">
                    <Link to={`/projects/${p.id}`}
                      className="flex items-center gap-1 text-blue-600 hover:text-blue-700 text-[12px] font-medium whitespace-nowrap">
                      {NEXT_ACTION[stage] || "View project"}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {filteredRows.length > 0 && (
        <div className="flex items-center justify-between mt-4 px-1">
          <p className="text-[12px] text-gray-500">
            Showing {Math.min((page - 1) * PER_PAGE + 1, filteredRows.length)} to {Math.min(page * PER_PAGE, filteredRows.length)} of {filteredRows.length} project{filteredRows.length !== 1 ? "s" : ""}
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-[12px]">
              ‹
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              const pg = page <= 3 ? i + 1 : page + i - 2;
              if (pg < 1 || pg > totalPages) return null;
              return (
                <button key={pg} onClick={() => setPage(pg)}
                  className={`w-8 h-8 flex items-center justify-center rounded-lg border text-[12px] font-medium transition ${
                    pg === page ? "bg-navy text-white border-navy" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                  }`}>
                  {pg}
                </button>
              );
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition text-[12px]">
              ›
            </button>
            <select value={PER_PAGE} className="ml-2 border border-gray-200 rounded-lg px-2 py-1 text-[12px] text-gray-600">
              <option value={10}>10 / page</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
