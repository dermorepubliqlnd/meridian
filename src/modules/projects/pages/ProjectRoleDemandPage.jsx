import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import PlanningFlowNav from "../components/PlanningFlowNav";
import {
  doc,
  collection,
  collectionGroup,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { userWeeklyProjectHours } from "../../../lib/bandwidth";

// ── Role → jobTitle matching (keys are lowercase-normalized) ──────────────────
// Using lowercase keys prevents casing/whitespace differences in WBS role names
// from bypassing the matcher and accidentally falling back to "show all users".

const ROLE_MATCHERS = {
  "project lead":           (jt) => /director|supervisor|project owner|project lead/i.test(jt),
  "project owner":          (jt) => /director|supervisor|project owner|project lead/i.test(jt),
  "instructional designer": (jt) => /instructional designer/i.test(jt),
  "content developer":      (jt) => /content developer/i.test(jt),
  "qa reviewer":            (jt) => /qa reviewer|quality/i.test(jt),
  "sme":                    (_jt) => false,
  "l&d supervisor":         (jt) => /l&d supervisor|supervisor/i.test(jt),
  "trainer":                (jt) => /\btrainer\b/i.test(jt),
  "l&d director":           (jt) => /l&d director|director/i.test(jt),
};

function matchUsersToRole(users, role) {
  if (!role) return [];
  const key = role.trim().toLowerCase();
  if (key === "sme") return [];
  const hasDefinedMatcher = key in ROLE_MATCHERS;
  const matcher = hasDefinedMatcher
    ? ROLE_MATCHERS[key]
    : (jt) => jt.trim().toLowerCase() === key;
  const matched = users.filter((u) => matcher(u.jobTitle ?? ""));
  return matched.length > 0 ? matched : (hasDefinedMatcher ? [] : users);
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function fmt(n) {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function utilPct(used, total) {
  if (!total) return 0;
  return Math.min(100, Math.round((used / total) * 100));
}

function StatusPill({ label, className }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${className}`}>
      {label}
    </span>
  );
}

function PlanningStatusPill({ status }) {
  const MAP = {
    "Approved":       "bg-emerald-100 text-emerald-700",
    "Pending Review": "bg-yellow-100  text-yellow-700",
    "Draft":          "bg-gray-100    text-gray-600",
    "On Hold":        "bg-orange-100  text-orange-700",
    "Cancelled":      "bg-red-100     text-red-700",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${MAP[status] ?? "bg-gray-100 text-gray-500"}`}>
      {status ?? "Unknown"}
    </span>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-[12px] text-gray-400">Loading role demand...</span>
      </div>
    </div>
  );
}

function GapDisplay({ gap }) {
  if (gap > 0)  return <span className="text-emerald-600 font-semibold">+{fmt(gap)} hrs</span>;
  if (gap < 0)  return <span className="text-red-600 font-semibold">-{fmt(Math.abs(gap))} hrs</span>;
  return <span className="text-gray-400 font-semibold">0 hrs</span>;
}

function statusBadge(gap) {
  if (gap > 0)   return { label: "Available", cls: "bg-emerald-100 text-emerald-700" };
  if (gap === 0) return { label: "Tight",     cls: "bg-yellow-100  text-yellow-700" };
  if (gap >= -8) return { label: "Short",     cls: "bg-orange-100  text-orange-700" };
  return               { label: "At Risk",   cls: "bg-red-100     text-red-700"    };
}

// ── Utilization bar ───────────────────────────────────────────────────────────

function UtilBar({ used, total }) {
  const p = utilPct(used, total);
  const color = p > 100 ? "bg-red-400" : p > 80 ? "bg-orange-400" : "bg-[#14B8A6]";
  return (
    <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(p, 100)}%` }} />
    </div>
  );
}

// ── Team members section ──────────────────────────────────────────────────────

function TeamMembersSection({ roleDemand, users, committedByUser, planningWeeks }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left"
      >
        <div>
          <span className="text-[13px] font-semibold text-[#0F2240]">Team Members by Role</span>
          <span className="ml-2 text-[11px] text-gray-400">current utilization across all active projects</span>
        </div>
        <span className="text-gray-400 text-[12px]">{open ? "v" : ">"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {roleDemand.map(({ role, isSME }) => {
            const matched = matchUsersToRole(users, role);
            return (
              <div key={role} className="px-5 py-4">
                <p className="text-[11px] font-semibold text-[#14B8A6] uppercase tracking-wide mb-3">
                  {role}
                  {isSME && <span className="ml-1 normal-case font-normal text-gray-400">(external)</span>}
                </p>

                {isSME ? (
                  <p className="text-[12px] text-gray-400 italic">SME is external - no internal capacity tracked here.</p>
                ) : matched.length === 0 ? (
                  <p className="text-[12px] text-gray-400 italic">No team members matched for this role.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {matched.map((u) => {
                      const totalCap   = userWeeklyProjectHours(u) * planningWeeks;
                      const committed  = committedByUser[u.id] ?? 0;
                      const available  = Math.max(0, totalCap - committed);
                      const p          = utilPct(committed, totalCap);
                      const overloaded = committed > totalCap;

                      const sLabel = overloaded ? "Overloaded" : p >= 85 ? "Tight" : p >= 50 ? "Partial" : "Available";
                      const sCls   = overloaded
                        ? "bg-red-50 text-red-600 border-red-200"
                        : p >= 85
                        ? "bg-orange-50 text-orange-600 border-orange-200"
                        : p >= 50
                        ? "bg-yellow-50 text-yellow-600 border-yellow-200"
                        : "bg-emerald-50 text-emerald-600 border-emerald-200";

                      return (
                        <div key={u.id} className="bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-[#0F2240] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                              {(u.name ?? "?").split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase()}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-[12px] font-semibold text-[#0F2240] truncate">{u.name ?? "-"}</p>
                              <p className="text-[10px] text-gray-400 truncate">{u.jobTitle ?? "-"}</p>
                            </div>
                            <span className={`text-[9px] border rounded-full px-1.5 py-0.5 font-semibold flex-shrink-0 ${sCls}`}>
                              {sLabel}
                            </span>
                          </div>
                          <UtilBar used={committed} total={totalCap} />
                          <div className="flex justify-between text-[10px] text-gray-500">
                            <span><span className="font-semibold text-gray-700">{fmt(available)} hrs</span> free</span>
                            <span><span className={`font-semibold ${overloaded ? "text-red-500" : "text-gray-600"}`}>{fmt(committed)} hrs</span> committed</span>
                            <span className="text-gray-400">{p}% used</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Project duration helper ───────────────────────────────────────────────────

function projectDurationWeeks(project) {
  if (!project?.startDate || !project?.targetLaunchDate) return 8;
  const start = new Date(project.startDate + "T00:00:00");
  const end   = new Date(project.targetLaunchDate + "T00:00:00");
  return Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24 * 7)));
}

const WINDOW_OPTIONS = [
  { label: "4 weeks",  value: 4  },
  { label: "8 weeks",  value: 8  },
  { label: "12 weeks", value: 12 },
  { label: "16 weeks", value: 16 },
];

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ProjectRoleDemandPage() {
  const { id } = useParams();

  const [project,        setProject]        = useState(null);
  const [tasks,          setTasks]          = useState([]);
  const [users,          setUsers]          = useState([]);
  const [allProjects,    setAllProjects]    = useState([]);
  const [allAssignments, setAllAssignments] = useState([]);
  const [planningWeeks,  setPlanningWeeks]  = useState(null);
  const [toastMsg,       setToastMsg]       = useState(null);
  const [recalcKey,      setRecalcKey]      = useState(0);

  // ── Subscriptions ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, "projects", id), (snap) =>
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : undefined)
    );
  }, [id]);

  useEffect(() => {
    if (!id) return;
    return onSnapshot(
      query(collection(db, "projects", id, "tasks"), orderBy("order", "asc")),
      (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, [id]);

  useEffect(() => {
    return onSnapshot(collection(db, "users"), (snap) =>
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))
    );
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, "projects"), (snap) =>
      setAllProjects(snap.docs.map((d) => ({ id: d.id, status: d.data().status })))
    );
  }, []);

  // Cross-project assignments (flatten assignees[] model)
  useEffect(() => {
    return onSnapshot(collectionGroup(db, "assignments"), (snap) => {
      const flat = [];
      snap.docs.forEach((d) => {
        const data      = d.data();
        const projectId = d.ref.parent.parent.id;
        if (data.assignees?.length) {
          data.assignees.forEach((slot) => {
            if (slot.userId)
              flat.push({ projectId, userId: slot.userId, allocationPct: slot.allocationPct ?? 100 });
          });
        } else if (data.userId) {
          flat.push({ projectId, userId: data.userId, allocationPct: data.allocationPct ?? 100 });
        }
      });
      setAllAssignments(flat);
    });
  }, []);

  useEffect(() => {
    if (project && planningWeeks === null)
      setPlanningWeeks(project.planningWeeks || projectDurationWeeks(project));
  }, [project, planningWeeks]);

  // ── Cross-project committed hours per user ────────────────────────────────

  const committedByUser = useMemo(() => {
    if (planningWeeks === null) return {};
    const ACTIVE = new Set(["Active", "WBS Pending", "Resource Check", "Pending Approval"]);
    const otherActiveIds = new Set(
      allProjects.filter((p) => ACTIVE.has(p.status) && p.id !== id).map((p) => p.id)
    );
    const map = {};
    allAssignments
      .filter((a) => otherActiveIds.has(a.projectId))
      .forEach((a) => {
        const user = users.find((u) => u.id === a.userId);
        if (!user) return;
        const hrs = (a.allocationPct / 100) * userWeeklyProjectHours(user) * planningWeeks;
        map[a.userId] = (map[a.userId] ?? 0) + hrs;
      });
    return map;
  }, [allAssignments, allProjects, users, planningWeeks, id]);

  // ── Role demand rows ──────────────────────────────────────────────────────

  const roleDemand = useMemo(() => {
    if (planningWeeks === null) return [];
    recalcKey; // subscribe to recalc

    const topLevel = tasks.filter((t) => t.parentTaskId == null);
    const byRole   = {};
    for (const task of topLevel) {
      const role = task.responsibleRole;
      if (!role) continue;
      byRole[role] = (byRole[role] ?? 0) + (task.estimatedHours ?? 0);
    }
    const totalHours = Object.values(byRole).reduce((s, h) => s + h, 0);

    return Object.entries(byRole)
      .sort((a, b) => b[1] - a[1])
      .map(([role, needed]) => {
        const isSME     = role.trim().toLowerCase() === "sme";
        const matched   = matchUsersToRole(users, role);
        const totalCap  = isSME ? 0 : matched.reduce((s, u) => s + userWeeklyProjectHours(u) * planningWeeks, 0);
        const committed = isSME ? 0 : matched.reduce((s, u) => s + (committedByUser[u.id] ?? 0), 0);
        const available = Math.max(0, totalCap - committed);
        const gap       = available - needed;
        const effortPct = totalHours > 0 ? ((needed / totalHours) * 100).toFixed(1) : "0.0";
        return { role, needed, totalCap, committed, available, gap, effortPct, isSME };
      });
  }, [tasks, users, planningWeeks, committedByUser, recalcKey]);

  const totalNeeded    = roleDemand.reduce((s, r) => s + r.needed, 0);
  const totalAvailable = roleDemand.reduce((s, r) => s + r.available, 0);
  const overallGap     = totalAvailable - totalNeeded;
  const hasRoles       = roleDemand.length > 0;
  const gapRoles       = roleDemand.filter((r) => r.gap < 0 && !r.isSME);

  function showToast(msg) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  if (!project) return <Loading />;

  return (
    <div className="min-h-screen bg-gray-50">
      <PlanningFlowNav project={project} projectId={id} />

      <div className="px-6 py-5 max-w-6xl mx-auto space-y-5">

        {toastMsg && (
          <div className="fixed top-4 right-4 z-50 bg-[#0F2240] text-white text-[12px] font-medium px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2">
            <span className="text-[#14B8A6]">OK</span>{toastMsg}
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-[18px] font-bold text-[#0F2240]">Role Demand Summary</h1>
              <span className="inline-flex items-center gap-1.5 bg-[#0F2240]/5 border border-[#0F2240]/10 text-[#0F2240] text-[11px] font-semibold px-2.5 py-1 rounded-full">
                {project.projectCode && <span className="text-[#14B8A6]">{project.projectCode}</span>}
                {project.name}
              </span>
              <PlanningStatusPill status={project.planningStatus} />
            </div>
            <p className="text-[12px] text-gray-400 max-w-2xl leading-relaxed">
              Capacity shown is <strong className="font-semibold text-gray-600">net available</strong> — total capacity minus hours already committed on other active projects.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <select
              value={planningWeeks ?? ""}
              onChange={async (e) => {
                const val = Number(e.target.value);
                setPlanningWeeks(val);
                await updateDoc(doc(db, "projects", id), { planningWeeks: val });
              }}
              className="text-[12px] border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/40"
            >
              {WINDOW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              onClick={() => { setRecalcKey((k) => k + 1); showToast("Recalculated."); }}
              className="inline-flex items-center gap-1.5 bg-[#14B8A6] hover:bg-teal-600 text-white text-[12px] font-semibold px-3.5 py-1.5 rounded-lg shadow-sm transition-colors"
            >
              Recalculate
            </button>
          </div>
        </div>

        {/* Alert banners */}
        {hasRoles && (
          <div className="space-y-2">
            {gapRoles.length === 0 ? (
              <div className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                <span className="text-emerald-500 flex-shrink-0">OK</span>
                <p className="text-[12px] text-emerald-700 font-medium">
                  All role demand is covered by net available capacity across the {planningWeeks}-week window.
                </p>
              </div>
            ) : (
              gapRoles.map((r) => (
                <div key={r.role} className="flex items-start gap-2.5 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3">
                  <span className="text-yellow-500 flex-shrink-0 mt-0.5">!</span>
                  <p className="text-[12px] text-yellow-800">
                    <span className="font-semibold">{r.role}</span> needs <span className="font-semibold">{fmt(r.needed)} hrs</span> but only <span className="font-semibold">{fmt(r.available)} hrs</span> are free after existing commitments. Consider adjusting timelines or reassigning tasks.
                  </p>
                </div>
              ))
            )}
          </div>
        )}

        {/* Role Demand Table */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
            <p className="text-[13px] font-semibold text-[#0F2240]">Role Demand vs. Capacity</p>
            <span className="text-[11px] text-gray-400">
              Planning window: <span className="font-semibold text-gray-600">{planningWeeks} weeks</span>
            </span>
          </div>

          {!hasRoles ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <p className="text-[13px] font-semibold text-[#0F2240] mb-1">No roles assigned yet</p>
              <p className="text-[12px] text-gray-400 mb-4 max-w-sm">Go to the WBS to assign required roles to each task.</p>
              <Link to={`/projects/${id}/wbs`} className="inline-flex items-center gap-1.5 bg-[#14B8A6] hover:bg-teal-600 text-white text-[12px] font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors">
                Go to WBS
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr className="bg-gray-50">
                    {["Required Role", "WBS Hours", "% Effort", "Total Capacity", "Committed (Other Projects)", "Net Available", "Gap", "Status"].map((col) => (
                      <th key={col} className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wide text-gray-500 font-semibold whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {roleDemand.map(({ role, needed, totalCap, committed, available, gap, effortPct, isSME }) => {
                    const badge = statusBadge(gap);
                    return (
                      <tr key={role} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-[12px] font-semibold text-[#0F2240]">{role}</span>
                          {isSME && <span className="ml-1.5 text-[9px] text-gray-400 border border-gray-200 rounded-full px-1.5 py-0.5 font-medium">External</span>}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-[12px] font-semibold text-[#0F2240]">{fmt(needed)} hrs</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-[#14B8A6] rounded-full" style={{ width: `${Math.min(parseFloat(effortPct), 100)}%` }} />
                            </div>
                            <span className="text-[12px] text-gray-600">{effortPct}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {isSME
                            ? <span className="text-[12px] text-gray-400 italic">-</span>
                            : <span className="text-[12px] text-gray-500">{fmt(totalCap)} hrs</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          {isSME
                            ? <span className="text-[12px] text-gray-400 italic">-</span>
                            : committed > 0
                              ? <span className="text-[12px] font-medium text-orange-600">-{fmt(committed)} hrs</span>
                              : <span className="text-[12px] text-gray-400">None</span>
                          }
                        </td>
                        <td className="px-4 py-3">
                          {isSME
                            ? <span className="text-[12px] text-gray-400 italic">0 hrs (external)</span>
                            : <span className={`text-[12px] font-semibold ${available < needed ? "text-red-600" : "text-gray-700"}`}>{fmt(available)} hrs</span>
                          }
                        </td>
                        <td className="px-4 py-3"><GapDisplay gap={gap} /></td>
                        <td className="px-4 py-3"><StatusPill label={badge.label} className={badge.cls} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {hasRoles && (
            <div className="border-t border-gray-100 bg-gray-50 px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Total WBS Effort</span>
                <span className="text-[12px] font-bold text-[#0F2240]">{fmt(totalNeeded)} hrs</span>
              </div>
              <div className="w-px h-4 bg-gray-200 hidden sm:block" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Net Available</span>
                <span className="text-[12px] font-bold text-[#0F2240]">{fmt(totalAvailable)} hrs</span>
              </div>
              <div className="w-px h-4 bg-gray-200 hidden sm:block" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Overall Gap</span>
                <span className="text-[12px] font-bold"><GapDisplay gap={overallGap} /></span>
              </div>
              <div className="w-px h-4 bg-gray-200 hidden sm:block" />
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">Unique Roles</span>
                <span className="text-[12px] font-bold text-[#0F2240]">{roleDemand.length}</span>
              </div>
              <div className="flex-1" />
              <Link
                to={`/projects/${id}/resource-assignment`}
                className="inline-flex items-center gap-1.5 bg-[#0F2240] hover:bg-[#0F2240]/90 text-white text-[12px] font-semibold px-4 py-1.5 rounded-lg shadow-sm transition-colors whitespace-nowrap"
              >
                Proceed to Resource Assignment
              </Link>
            </div>
          )}
        </div>

        {/* Team Members by Role */}
        {hasRoles && (
          <TeamMembersSection
            roleDemand={roleDemand}
            users={users}
            committedByUser={committedByUser}
            planningWeeks={planningWeeks ?? 8}
          />
        )}
      </div>
    </div>
  );
}
