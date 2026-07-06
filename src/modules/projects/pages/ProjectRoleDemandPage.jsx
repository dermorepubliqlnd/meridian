import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import PlanningFlowNav from "../components/PlanningFlowNav";
import {
  doc,
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { userWeeklyProjectHours } from "../../../lib/bandwidth";

// ── Role → jobTitle matching ──────────────────────────────────────────────────

const ROLE_MATCHERS = {
  "Project Owner": (jt) =>
    /director|supervisor|project owner/i.test(jt),
  "Instructional Designer": (jt) =>
    jt.trim().toLowerCase() === "instructional designer",
  "Content Developer": (jt) =>
    jt.trim().toLowerCase() === "content developer",
  "QA Reviewer": (jt) =>
    /qa reviewer|quality/i.test(jt),
  "SME": (jt) =>
    jt.trim().toLowerCase() === "sme",
  "L&D Supervisor": (jt) =>
    jt.trim().toLowerCase() === "l&d supervisor",
};

/** Returns users whose jobTitle matches the given role. */
function matchUsersToRole(users, role) {
  const matcher =
    ROLE_MATCHERS[role] ??
    ((jt) => jt.trim().toLowerCase() === role.trim().toLowerCase());
  return users.filter((u) => matcher(u.jobTitle ?? ""));
}

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function fmt(n) {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function StatusPill({ label, className }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${className}`}
    >
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
  const cls = MAP[status] ?? "bg-gray-100 text-gray-500";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {status ?? "Unknown"}
    </span>
  );
}

function Loading() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-7 h-7 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
        <span className="text-[12px] text-gray-400">Loading role demand…</span>
      </div>
    </div>
  );
}

// ── Gap display ───────────────────────────────────────────────────────────────

function GapDisplay({ gap }) {
  if (gap > 0)
    return (
      <span className="text-emerald-600 font-semibold">
        +{fmt(gap)} hrs
      </span>
    );
  if (gap < 0)
    return (
      <span className="text-red-600 font-semibold">
        −{fmt(Math.abs(gap))} hrs
      </span>
    );
  return <span className="text-gray-400 font-semibold">0 hrs</span>;
}

function statusBadge(gap) {
  if (gap > 0)
    return { label: "Available", cls: "bg-emerald-100 text-emerald-700" };
  if (gap === 0)
    return { label: "Tight",     cls: "bg-yellow-100  text-yellow-700" };
  if (gap >= -5)
    return { label: "Short",     cls: "bg-orange-100  text-orange-700" };
  return   { label: "At Risk",   cls: "bg-red-100     text-red-700"    };
}

// ── Collapsible team-members section ─────────────────────────────────────────

function TeamMembersSection({ roleDemand, users }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-5 py-3.5 text-left"
      >
        <span className="text-[13px] font-semibold text-[#0F2240]">
          Team Members by Role
        </span>
        <span className="text-gray-400 text-[12px]">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {roleDemand.map(({ role }) => {
            const matched = matchUsersToRole(users, role);
            return (
              <div key={role} className="px-5 py-4">
                <p className="text-[11px] font-semibold text-[#14B8A6] uppercase tracking-wide mb-2">
                  {role}
                </p>
                {matched.length === 0 ? (
                  <p className="text-[12px] text-gray-400 italic">
                    {role === "SME"
                      ? "SME is external — no internal capacity."
                      : "No team members matched for this role."}
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {matched.map((u) => {
                      const wph = userWeeklyProjectHours(u);
                      return (
                        <div
                          key={u.id}
                          className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100"
                        >
                          {/* Avatar */}
                          <div className="w-7 h-7 rounded-full bg-[#0F2240] flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0">
                            {(u.name ?? "?")
                              .split(" ")
                              .map((w) => w[0])
                              .slice(0, 2)
                              .join("")
                              .toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-semibold text-[#0F2240] truncate">
                              {u.name ?? "—"}
                            </p>
                            <p className="text-[10px] text-gray-400 truncate">
                              {u.jobTitle ?? "—"}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-[11px] font-semibold text-[#14B8A6]">
                              {fmt(wph)} hrs/wk
                            </p>
                            <span className="text-[9px] bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full px-1.5 py-0.5 font-semibold">
                              Available
                            </span>
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

// ── Main page ─────────────────────────────────────────────────────────────────


// Compute project duration in weeks from startDate → targetLaunchDate (rounded up, min 1)
function projectDurationWeeks(project) {
  if (!project?.startDate || !project?.targetLaunchDate) return 8;
  const start = new Date(project.startDate + "T00:00:00");
  const end   = new Date(project.targetLaunchDate + "T00:00:00");
  const days  = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.ceil(days / 7));
}

const WINDOW_OPTIONS = [
  { label: "4 weeks",  value: 4  },
  { label: "8 weeks",  value: 8  },
  { label: "12 weeks", value: 12 },
  { label: "16 weeks", value: 16 },
];

export default function ProjectRoleDemandPage() {
  const { id } = useParams();

  // ── State — all hooks declared before any early return ──────────────────────
  const [project, setProject]         = useState(null);
  const [tasks,   setTasks]           = useState([]);
  const [users,   setUsers]           = useState([]);
  const [planningWeeks, setPlanningWeeks] = useState(null);
  const [toastMsg, setToastMsg]       = useState(null);
  const [recalcKey, setRecalcKey]     = useState(0);

  // ── Firestore subscriptions ─────────────────────────────────────────────────

  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, "projects", id), (snap) => {
      if (snap.exists()) {
        setProject({ id: snap.id, ...snap.data() });
      } else {
        setProject(undefined); // not found
      }
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const q = query(
      collection(db, "projects", id, "tasks"),
      orderBy("order", "asc")
    );
    return onSnapshot(q, (snap) => {
      setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [id]);

  useEffect(() => {
    return onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  // Seed from saved planningWeeks; fall back to project duration
  useEffect(() => {
    if (project && planningWeeks === null) {
      setPlanningWeeks(project.planningWeeks || projectDurationWeeks(project));
    }
  }, [project, planningWeeks]);

  // ── Derived data — role demand ──────────────────────────────────────────────

  const roleDemand = useMemo(() => {
    if (planningWeeks === null) return [];
    // eslint-disable-next-line no-unused-expressions
    recalcKey; // subscribe to recalc trigger

    // Only top-level tasks
    const topLevel = tasks.filter(
      (t) => t.parentTaskId === null || t.parentTaskId === undefined
    );

    // Group by responsibleRole
    const byRole = {};
    for (const task of topLevel) {
      const role = task.responsibleRole;
      if (!role) continue;
      if (!byRole[role]) byRole[role] = 0;
      byRole[role] += task.estimatedHours ?? 0;
    }

    const totalHours = Object.values(byRole).reduce((s, h) => s + h, 0);

    return Object.entries(byRole)
      .sort((a, b) => b[1] - a[1]) // sort by hours desc
      .map(([role, needed]) => {
        const isSME = role.trim().toLowerCase() === "sme";

        const capacityHrs = isSME
          ? 0
          : matchUsersToRole(users, role).reduce(
              (sum, u) => sum + userWeeklyProjectHours(u) * planningWeeks,
              0
            );

        const gap = capacityHrs - needed;
        const pct =
          totalHours > 0
            ? ((needed / totalHours) * 100).toFixed(1)
            : "0.0";

        return { role, needed, capacityHrs, gap, pct, isSME };
      });
  }, [tasks, users, planningWeeks, recalcKey]);

  const totalNeeded   = roleDemand.reduce((s, r) => s + r.needed, 0);
  const totalCapacity = roleDemand.reduce((s, r) => s + r.capacityHrs, 0);
  const overallGap    = totalCapacity - totalNeeded;
  const hasRoles      = roleDemand.length > 0;
  const gapRoles      = roleDemand.filter((r) => r.gap < 0);

  // ── Toast handler ───────────────────────────────────────────────────────────

  function showToast(msg) {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  }

  function handleRecalculate() {
    setRecalcKey((k) => k + 1);
    showToast("Role demand recalculated.");
  }

  // ── Early return guard ──────────────────────────────────────────────────────

  if (!project) return <Loading />;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      <PlanningFlowNav project={project} projectId={id} />

      <div className="px-6 py-5 max-w-6xl mx-auto space-y-5">

      {/* Toast */}
      {toastMsg && (
        <div className="fixed top-4 right-4 z-50 bg-[#0F2240] text-white text-[12px] font-medium px-4 py-2.5 rounded-lg shadow-lg flex items-center gap-2 animate-fadeIn">
          <span className="text-[#14B8A6]">✓</span>
          {toastMsg}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div>
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-[18px] font-bold text-[#0F2240]">
                Role Demand Summary
              </h1>
              {/* Project name chip */}
              <span className="inline-flex items-center gap-1.5 bg-[#0F2240]/5 border border-[#0F2240]/10 text-[#0F2240] text-[11px] font-semibold px-2.5 py-1 rounded-full">
                {project.projectCode && (
                  <span className="text-[#14B8A6]">{project.projectCode}</span>
                )}
                {project.name}
              </span>
              <PlanningStatusPill status={project.planningStatus} />
            </div>
            <p className="text-[12px] text-gray-400 max-w-2xl leading-relaxed">
              Based on WBS effort totals. Available capacity is calculated over
              the selected planning window.
            </p>
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <select
              value={planningWeeks}
              onChange={async (e) => {
                const val = Number(e.target.value);
                setPlanningWeeks(val);
                await updateDoc(doc(db, "projects", id), { planningWeeks: val });
              }}
              className="text-[12px] border border-gray-200 rounded-lg px-3 py-1.5 text-gray-700 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#14B8A6]/40"
            >
              {WINDOW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleRecalculate}
              className="inline-flex items-center gap-1.5 bg-[#14B8A6] hover:bg-teal-600 text-white text-[12px] font-semibold px-3.5 py-1.5 rounded-lg shadow-sm transition-colors"
            >
              ↻ Recalculate
            </button>
          </div>
        </div>
      </div>

      {/* ── Alert banners ───────────────────────────────────────────────────── */}
      {hasRoles && (
        <div className="space-y-2">
          {gapRoles.length === 0 ? (
            <div className="flex items-start gap-2.5 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
              <span className="text-emerald-500 text-[15px] flex-shrink-0">✓</span>
              <p className="text-[12px] text-emerald-700 font-medium">
                All role demand is covered within the selected{" "}
                {planningWeeks}-week planning window.
              </p>
            </div>
          ) : (
            gapRoles.map((r) => (
              <div
                key={r.role}
                className="flex items-start gap-2.5 bg-yellow-50 border border-yellow-200 rounded-lg px-4 py-3"
              >
                <span className="text-yellow-500 text-[14px] flex-shrink-0 mt-0.5">⚠</span>
                <p className="text-[12px] text-yellow-800">
                  <span className="font-semibold">{r.role}</span> is short by{" "}
                  <span className="font-semibold">
                    {fmt(Math.abs(r.gap))} hrs
                  </span>{" "}
                  over the selected {planningWeeks}-week window. Consider adding
                  capacity, reassigning tasks, or adjusting the timeline.
                </p>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Role Demand Table ───────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
          <p className="text-[13px] font-semibold text-[#0F2240]">
            Role Demand vs. Capacity
          </p>
          <span className="text-[11px] text-gray-400">
            Planning window: <span className="font-semibold text-gray-600">{planningWeeks} weeks</span>
          </span>
        </div>

        {!hasRoles ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="w-12 h-12 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center mb-3 text-xl">
              👥
            </div>
            <p className="text-[13px] font-semibold text-[#0F2240] mb-1">
              No roles assigned yet
            </p>
            <p className="text-[12px] text-gray-400 mb-4 max-w-sm">
              Go to the WBS to assign required roles to each task. Role demand
              will appear here automatically.
            </p>
            <Link
              to={`/projects/${id}/wbs`}
              className="inline-flex items-center gap-1.5 bg-[#14B8A6] hover:bg-teal-600 text-white text-[12px] font-semibold px-4 py-2 rounded-lg shadow-sm transition-colors"
            >
              Go to WBS →
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="bg-gray-50">
                  {[
                    "Required Role",
                    "Total Hours Needed",
                    "% of Total Effort",
                    `Available Capacity (Next ${planningWeeks} Wks)`,
                    "Gap / Surplus",
                    "Status",
                  ].map((col) => (
                    <th
                      key={col}
                      className="px-4 py-2.5 text-left text-[10px] uppercase tracking-wide text-gray-500 font-semibold whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {roleDemand.map(({ role, needed, capacityHrs, gap, pct, isSME }) => {
                  const badge = statusBadge(gap);
                  return (
                    <tr
                      key={role}
                      className="hover:bg-slate-50/50 transition-colors"
                    >
                      {/* Required Role */}
                      <td className="px-4 py-3">
                        <span className="text-[12px] font-semibold text-[#0F2240]">
                          {role}
                        </span>
                        {isSME && (
                          <span className="ml-1.5 text-[9px] text-gray-400 border border-gray-200 rounded-full px-1.5 py-0.5 font-medium">
                            External
                          </span>
                        )}
                      </td>

                      {/* Total Hours Needed */}
                      <td className="px-4 py-3">
                        <span className="text-[12px] font-semibold text-[#0F2240]">
                          {fmt(needed)} hrs
                        </span>
                      </td>

                      {/* % of Total Effort */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#14B8A6] rounded-full"
                              style={{ width: `${Math.min(parseFloat(pct), 100)}%` }}
                            />
                          </div>
                          <span className="text-[12px] text-gray-600">
                            {pct}%
                          </span>
                        </div>
                      </td>

                      {/* Available Capacity */}
                      <td className="px-4 py-3">
                        {isSME ? (
                          <span className="text-[12px] text-gray-400 italic">
                            0 hrs (external)
                          </span>
                        ) : (
                          <span className="text-[12px] text-gray-700">
                            {fmt(capacityHrs)} hrs
                          </span>
                        )}
                      </td>

                      {/* Gap / Surplus */}
                      <td className="px-4 py-3 text-[12px]">
                        <GapDisplay gap={gap} />
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <StatusPill
                          label={badge.label}
                          className={badge.cls}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Summary footer bar ──────────────────────────────────────────── */}
        {hasRoles && (
          <div className="border-t border-gray-100 bg-gray-50 px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
                Total WBS Effort
              </span>
              <span className="text-[12px] font-bold text-[#0F2240]">
                {fmt(totalNeeded)} hrs
              </span>
            </div>

            <div className="w-px h-4 bg-gray-200 hidden sm:block" />

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
                Total Available Capacity
              </span>
              <span className="text-[12px] font-bold text-[#0F2240]">
                {fmt(totalCapacity)} hrs
              </span>
            </div>

            <div className="w-px h-4 bg-gray-200 hidden sm:block" />

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
                Overall Gap
              </span>
              <span className="text-[12px] font-bold">
                <GapDisplay gap={overallGap} />
              </span>
            </div>

            <div className="w-px h-4 bg-gray-200 hidden sm:block" />

            <div className="flex items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-gray-400 font-semibold">
                Unique Roles
              </span>
              <span className="text-[12px] font-bold text-[#0F2240]">
                {roleDemand.length}
              </span>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            <Link
              to={`/projects/${id}/resource-assignment`}
              className="inline-flex items-center gap-1.5 bg-[#0F2240] hover:bg-[#0F2240]/90 text-white text-[12px] font-semibold px-4 py-1.5 rounded-lg shadow-sm transition-colors whitespace-nowrap"
            >
              Proceed to Resource Assignment →
            </Link>
          </div>
        )}
      </div>

      {/* ── Team Members by Role ────────────────────────────────────────────── */}
      {hasRoles && (
        <TeamMembersSection roleDemand={roleDemand} users={users} />
      )}
    </div>
      </div>
  );
}
