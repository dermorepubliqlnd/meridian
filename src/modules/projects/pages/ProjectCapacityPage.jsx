import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  doc,
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { userWeeklyProjectHours } from "../../../lib/bandwidth";

// ─── Constants ───────────────────────────────────────────────────────────────

const PLANNING_WINDOW_OPTIONS = [4, 8, 12];
const DEFAULT_PLANNING_WEEKS = 8;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function addWorkingDays(startDateStr, days) {
  if (!startDateStr || days <= 0) return startDateStr;
  const d = new Date(startDateStr + "T00:00:00");
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d.toISOString().split("T")[0];
}

function workingDaysBetween(startStr, endStr) {
  if (!startStr || !endStr) return 0;
  const start = new Date(startStr + "T00:00:00");
  const end = new Date(endStr + "T00:00:00");
  if (end <= start) return 0;
  let count = 0;
  const d = new Date(start);
  while (d < end) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) count++;
  }
  return count;
}

function formatDate(str) {
  if (!str) return "—";
  const d = new Date(str + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getInitials(name) {
  if (!name) return "?";
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function capacityStatus(gap) {
  if (gap < 0) return "overallocated";
  if (gap <= 5) return "limited";
  return "available";
}

function statusColors(status) {
  switch (status) {
    case "overallocated":
      return { text: "text-red-600", bg: "bg-red-100", badge: "bg-red-100 text-red-700" };
    case "limited":
      return { text: "text-amber-600", bg: "bg-amber-100", badge: "bg-amber-100 text-amber-700" };
    default:
      return { text: "text-emerald-600", bg: "bg-emerald-100", badge: "bg-emerald-100 text-emerald-700" };
  }
}

function planningStatusPillColor(status) {
  const map = {
    "Not Started": "bg-gray-100 text-gray-600",
    "In Planning": "bg-blue-100 text-blue-700",
    "Resource Check": "bg-amber-100 text-amber-700",
    "Pending Approval": "bg-purple-100 text-purple-700",
    Approved: "bg-emerald-100 text-emerald-700",
    "On Hold": "bg-red-100 text-red-700",
  };
  return map[status] || "bg-gray-100 text-gray-600";
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ message, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3500);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-gray-900 text-white text-sm px-5 py-3 rounded-xl shadow-lg flex items-center gap-3">
      <span>{message}</span>
      <button onClick={onClose} className="text-gray-400 hover:text-white ml-2">✕</button>
    </div>
  );
}

// ─── Action Card ──────────────────────────────────────────────────────────────

function ActionCard({ icon, title, description, onClick, to }) {
  const inner = (
    <div className="bg-white rounded-xl border-2 border-gray-200 hover:border-teal-400 p-4 cursor-pointer transition text-center flex flex-col items-center gap-2 h-full">
      <div className="text-2xl">{icon}</div>
      <div className="font-semibold text-gray-800 text-sm">{title}</div>
      <div className="text-gray-500 text-xs">{description}</div>
    </div>
  );

  if (to) {
    return <Link to={to} className="block h-full">{inner}</Link>;
  }
  return <button onClick={onClick} className="block w-full h-full text-left">{inner}</button>;
}

// ─── Timeline Bar ─────────────────────────────────────────────────────────────

function TimelineBar({ startDate, effortEndDate, forecastEndDate, targetDate }) {
  const dates = [startDate, effortEndDate, forecastEndDate, targetDate].filter(Boolean);
  if (dates.length < 2) return null;

  const allMs = dates.map((d) => new Date(d + "T00:00:00").getTime());
  const minMs = Math.min(...allMs);
  const maxMs = Math.max(...allMs);
  const range = maxMs - minMs || 1;

  function pct(dateStr) {
    if (!dateStr) return 0;
    const ms = new Date(dateStr + "T00:00:00").getTime();
    return ((ms - minMs) / range) * 100;
  }

  const bars = [
    { label: "Effort-Based", date: effortEndDate, color: "bg-gray-400", pct: pct(effortEndDate) },
    { label: "Forecast", date: forecastEndDate, color: "bg-orange-400", pct: pct(forecastEndDate) },
    { label: "Target", date: targetDate, color: "bg-blue-400", pct: pct(targetDate) },
  ].filter((b) => b.date);

  return (
    <div className="mt-4 space-y-2">
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>{formatDate(startDate)}</span>
        <span>{formatDate(dates[dates.length - 1])}</span>
      </div>
      {bars.map((bar) => (
        <div key={bar.label} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-28 shrink-0">{bar.label}</span>
          <div className="flex-1 bg-gray-100 rounded-full h-3 relative">
            <div
              className={`${bar.color} h-3 rounded-full`}
              style={{ width: `${Math.max(2, bar.pct)}%` }}
            />
          </div>
          <span className="text-xs text-gray-500 w-24 text-right shrink-0">{formatDate(bar.date)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectCapacityPage() {
  const { id } = useParams();

  // All state declared before any early returns
  const [project, setProject] = useState(undefined);
  const [tasks, setTasks] = useState(null);
  const [users, setUsers] = useState(null);
  const [assignments, setAssignments] = useState(null);
  const [planningWeeks, setPlanningWeeks] = useState(DEFAULT_PLANNING_WEEKS);
  const [toast, setToast] = useState(null);
  const [markingChecked, setMarkingChecked] = useState(false);

  // Firestore subscriptions
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "projects", id), (snap) => {
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    return unsub;
  }, [id]);

  useEffect(() => {
    const q = query(collection(db, "projects", id, "tasks"), orderBy("order"));
    const unsub = onSnapshot(q, (snap) => {
      setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [id]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "projects", id, "assignments"), (snap) => {
      setAssignments(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [id]);

  // ── Derived calculations ──────────────────────────────────────────────────

  const topLevelTasks = useMemo(() => {
    if (!tasks) return [];
    return tasks.filter(
      (t) => t.parentTaskId === null || t.parentTaskId === undefined
    );
  }, [tasks]);

  // Hours needed per role
  const hoursByRole = useMemo(() => {
    const map = {};
    for (const task of topLevelTasks) {
      const role = task.responsibleRole || "Unassigned";
      map[role] = (map[role] || 0) + (task.estimatedHours || 0);
    }
    return map;
  }, [topLevelTasks]);

  // Per-person capacity data
  const personCapacity = useMemo(() => {
    if (!assignments || !users) return [];

    return assignments.map((asgn) => {
      const user = users.find((u) => u.id === asgn.userId) || {};
      const availableHrs = userWeeklyProjectHours(user) * planningWeeks;
      const roleHours = hoursByRole[asgn.role] || 0;
      const allocationFactor = (asgn.allocationPct || 100) / 100;
      const hoursNeeded = roleHours * allocationFactor;
      const gap = availableHrs - hoursNeeded;
      const status = capacityStatus(gap);

      return {
        assignmentId: asgn.id,
        userId: asgn.userId,
        name: user.name || "Unknown",
        jobTitle: user.jobTitle || "",
        role: asgn.role,
        allocationPct: asgn.allocationPct || 100,
        availableHrs,
        hoursNeeded,
        gap,
        status,
      };
    });
  }, [assignments, users, hoursByRole, planningWeeks]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const overallocated = personCapacity.filter((p) => p.gap < 0).length;
    const limited = personCapacity.filter((p) => p.gap >= 0 && p.gap <= 5).length;
    const totalNeeded = personCapacity.reduce((s, p) => s + p.hoursNeeded, 0);
    const totalAvailable = personCapacity.reduce((s, p) => s + p.availableHrs, 0);
    const capacityGap = totalAvailable - totalNeeded;
    return { overallocated, limited, totalNeeded, totalAvailable, capacityGap };
  }, [personCapacity]);

  // Top 3 risks (most overallocated first)
  const topRisks = useMemo(() => {
    // Only show people who are actually short or tight (gap <= 5)
    return [...personCapacity]
      .filter((p) => p.gap <= 5)
      .sort((a, b) => a.gap - b.gap)
      .slice(0, 3);
  }, [personCapacity]);

  // Forecast dates
  const forecastData = useMemo(() => {
    if (!project || !users || !assignments) return null;

    const totalEffortHrs = topLevelTasks.reduce((s, t) => s + (t.estimatedHours || 0), 0);

    // Team daily capacity: sum of (weeklyProjectHrs / 5) for all assigned users
    const assignedUsers = assignments
      .map((a) => users.find((u) => u.id === a.userId))
      .filter(Boolean);

    const teamDailyCapacity = assignedUsers.reduce((s, u) => {
      return s + userWeeklyProjectHours(u) / 5;
    }, 0);

    const effortBasedDays =
      teamDailyCapacity > 0 ? Math.ceil(totalEffortHrs / teamDailyCapacity) : 0;

    // Adjustment factor: if any person is overallocated, add buffer
    const overallocatedCount = personCapacity.filter((p) => p.gap < 0).length;
    const totalPeople = personCapacity.length || 1;
    const overallocatedRatio = overallocatedCount / totalPeople;
    // Buffer: 0% if no overallocation, up to 25% if all overallocated
    const adjustmentFactor = 1 + overallocatedRatio * 0.25;
    const resourceLoadedDays = Math.ceil(effortBasedDays * adjustmentFactor);

    const startDate = project.startDate || null;
    const effortEndDate = startDate ? addWorkingDays(startDate, effortBasedDays) : null;
    const forecastEndDate = startDate ? addWorkingDays(startDate, resourceLoadedDays) : null;
    const targetDate = project.targetLaunchDate || null;

    let varianceDays = null;
    let varianceLabel = "";
    let varianceColor = "text-gray-500";

    if (forecastEndDate && targetDate) {
      const fMs = new Date(forecastEndDate + "T00:00:00").getTime();
      const tMs = new Date(targetDate + "T00:00:00").getTime();
      if (fMs > tMs) {
        const diffDays = workingDaysBetween(targetDate, forecastEndDate);
        varianceDays = diffDays;
        varianceLabel = `+${diffDays} working days`;
        varianceColor = "text-red-600";
      } else if (fMs < tMs) {
        const diffDays = workingDaysBetween(forecastEndDate, targetDate);
        varianceDays = -diffDays;
        varianceLabel = `-${diffDays} working days`;
        varianceColor = "text-emerald-600";
      } else {
        varianceDays = 0;
        varianceLabel = "On Track";
        varianceColor = "text-emerald-600";
      }
    }

    return {
      totalEffortHrs,
      teamDailyCapacity,
      effortBasedDays,
      resourceLoadedDays,
      startDate,
      effortEndDate,
      forecastEndDate,
      targetDate,
      varianceDays,
      varianceLabel,
      varianceColor,
    };
  }, [project, users, assignments, topLevelTasks, personCapacity]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  async function handleMarkCapacityChecked() {
    if (!project || markingChecked) return;
    setMarkingChecked(true);
    try {
      await updateDoc(doc(db, "projects", id), {
        planningStatus: "Pending Approval",
        updatedAt: serverTimestamp(),
      });
      setToast("Planning status updated to Pending Approval.");
    } catch (err) {
      setToast("Failed to update status. Please try again.");
    } finally {
      setMarkingChecked(false);
    }
  }

  // ── Loading guard ─────────────────────────────────────────────────────────

  if (project === undefined || tasks === null || assignments === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm animate-pulse">Loading capacity data…</div>
      </div>
    );
  }

  if (project === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-500 text-sm">Project not found.</div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const { overallocated, limited, totalNeeded, totalAvailable, capacityGap } = summaryStats;
  const progressPct =
    totalAvailable > 0 ? Math.min(100, (totalNeeded / totalAvailable) * 100) : 0;
  const progressColor =
    capacityGap < 0 ? "bg-red-500" : capacityGap <= 5 ? "bg-amber-400" : "bg-emerald-500";

  const overallocatedPeople = personCapacity.filter((p) => p.gap < 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <Link
          to={`/projects/${id}`}
          className="text-sm text-teal-600 hover:text-teal-700 font-medium flex items-center gap-1 mb-3"
        >
          ← Back to Project
        </Link>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-bold" style={{ color: "#0F2240" }}>
              Capacity Check &amp; Forecast
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">
              Resource-loaded forecast based on assigned team capacity and WBS effort.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Project name chip */}
            <span className="bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full font-medium">
              {project.name || "Unnamed Project"}
            </span>

            {/* Planning status pill */}
            {project.planningStatus && (
              <span
                className={`text-xs px-3 py-1 rounded-full font-semibold ${planningStatusPillColor(
                  project.planningStatus
                )}`}
              >
                {project.planningStatus}
              </span>
            )}

            {/* Planning window dropdown */}
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 whitespace-nowrap">Planning window:</label>
              <select
                value={planningWeeks}
                onChange={(e) => setPlanningWeeks(Number(e.target.value))}
                className="border border-gray-300 rounded-lg text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-400"
              >
                {PLANNING_WINDOW_OPTIONS.map((w) => (
                  <option key={w} value={w}>
                    {w} weeks
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Mark Capacity Checked button */}
        {project.planningStatus === "Resource Check" && (
          <div className="mt-4">
            <button
              onClick={handleMarkCapacityChecked}
              disabled={markingChecked}
              className="text-sm font-semibold px-4 py-2 rounded-lg text-white transition disabled:opacity-50"
              style={{ backgroundColor: "#0F2240" }}
            >
              {markingChecked ? "Updating…" : "Mark Capacity Checked"}
            </button>
          </div>
        )}
      </div>

      {/* ── Two-column body ────────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 py-6 grid grid-cols-3 gap-5">

        {/* Left — Capacity Summary */}
        <div className="col-span-1 bg-white rounded-xl border border-gray-200 shadow-sm p-5 self-start">
          <h2 className="text-base font-bold mb-4" style={{ color: "#0F2240" }}>
            Capacity Summary
          </h2>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between items-center">
              <span className="text-gray-500">People Overallocated</span>
              <span className={`font-bold ${overallocated > 0 ? "text-red-600" : "text-gray-700"}`}>
                {overallocated}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">People Limited</span>
              <span className={`font-bold ${limited > 0 ? "text-amber-600" : "text-gray-700"}`}>
                {limited}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500">Total Hours Needed</span>
              <span className="font-bold text-gray-800">{totalNeeded.toFixed(1)} hrs</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500" title="Combined project-hours available across all assigned team members over the planning window">Team Pool ({planningWeeks}wk)</span>
              <span className="font-bold text-gray-800">{totalAvailable.toFixed(1)} hrs</span>
            </div>
            <div className="flex justify-between items-center border-t border-gray-100 pt-3">
              <span className="text-gray-600 font-medium">Capacity Gap</span>
              <span
                className={`font-bold ${
                  capacityGap < 0 ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {capacityGap >= 0 ? "+" : ""}
                {capacityGap.toFixed(1)} hrs
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Demand vs. Capacity</span>
              <span>{Math.round(progressPct)}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-2.5">
              <div
                className={`${progressColor} h-2.5 rounded-full transition-all`}
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* Top Capacity Risks */}
          <div className="mt-5">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              {topRisks.length === 0 ? "Team Availability" : "Capacity Risks"}
            </h3>
            {topRisks.length === 0 ? (
              <p className="text-xs text-emerald-600 font-medium">✓ No risks — all assigned members have sufficient capacity.</p>
            ) : (
              <div className="space-y-2">
                {topRisks.map((p) => {
                  const colors = statusColors(p.status);
                  return (
                    <div
                      key={p.assignmentId}
                      className="flex items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                          style={{ backgroundColor: "#0F2240" }}
                        >
                          {getInitials(p.name)}
                        </div>
                        <span className="text-sm text-gray-700 truncate">{p.name}</span>
                      </div>
                      <span className={`text-xs font-semibold shrink-0 ${colors.text}`}>
                        {p.gap >= 0 ? "+" : ""}
                        {p.gap.toFixed(1)} hrs
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right — Resource-Loaded Forecast */}
        <div className="col-span-2 bg-white rounded-xl border border-gray-200 shadow-sm p-5 self-start">
          <h2 className="text-base font-bold mb-4" style={{ color: "#0F2240" }}>
            Resource-Loaded Forecast
          </h2>

          {forecastData ? (
            <>
              {/* Date rows */}
              <div className="space-y-3 text-sm">
                {/* Requested Launch Date */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500 w-56 shrink-0">Requested Launch Date</span>
                  <span className="font-medium text-gray-800">
                    {formatDate(forecastData.targetDate)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700">
                    Target
                  </span>
                </div>

                {/* Effort-Based End Date */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500 w-56 shrink-0">Effort-Based End Date (ideal)</span>
                  <span className="font-medium text-gray-800">
                    {formatDate(forecastData.effortEndDate)}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-600">
                    Ideal
                  </span>
                </div>

                {/* Forecast End Date */}
                <div className="flex items-center justify-between gap-3">
                  <span className="text-gray-500 w-56 shrink-0">Forecast End Date (Resource-Loaded)</span>
                  <span className="font-medium text-gray-800">
                    {formatDate(forecastData.forecastEndDate)}
                  </span>
                  {forecastData.forecastEndDate && forecastData.targetDate ? (
                    <span
                      className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        forecastData.forecastEndDate > forecastData.targetDate
                          ? "bg-orange-100 text-orange-700"
                          : "bg-emerald-100 text-emerald-700"
                      }`}
                    >
                      {forecastData.forecastEndDate > forecastData.targetDate
                        ? "At Risk"
                        : "On Track"}
                    </span>
                  ) : null}
                </div>

                {/* Variance */}
                <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-3">
                  <span className="text-gray-600 font-medium w-56 shrink-0">Variance vs. Target</span>
                  <span className={`font-bold ${forecastData.varianceColor}`}>
                    {forecastData.varianceLabel || "—"}
                  </span>
                  <span />
                </div>
              </div>

              {/* Team capacity summary */}
              <div className="mt-4 bg-gray-50 rounded-lg p-3 text-sm text-gray-600 flex flex-wrap gap-4">
                <span>
                  <span className="font-medium text-gray-800">{forecastData.totalEffortHrs.toFixed(0)} hrs</span> total effort
                </span>
                <span>
                  <span className="font-medium text-gray-800">{forecastData.teamDailyCapacity.toFixed(1)} hrs/day</span> team capacity
                </span>
                <span>
                  <span className="font-medium text-gray-800">{forecastData.effortBasedDays} days</span> ideal duration
                </span>
                <span>
                  <span className="font-medium text-gray-800">{forecastData.resourceLoadedDays} days</span> resource-loaded duration
                </span>
              </div>

              {/* Timeline bar */}
              <TimelineBar
                startDate={forecastData.startDate}
                effortEndDate={forecastData.effortEndDate}
                forecastEndDate={forecastData.forecastEndDate}
                targetDate={forecastData.targetDate}
              />

              {/* Overallocated people sub-section */}
              {overallocatedPeople.length > 0 && (
                <div className="mt-5">
                  <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                    Overallocated Team Members
                  </h3>
                  <div className="flex flex-wrap gap-3">
                    {overallocatedPeople.map((p) => (
                      <div
                        key={p.assignmentId}
                        className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2"
                      >
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0"
                          style={{ backgroundColor: "#0F2240" }}
                        >
                          {getInitials(p.name)}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-gray-800">{p.name}</div>
                          <div className="text-xs text-red-600 font-semibold">
                            {p.gap.toFixed(1)} hrs
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-gray-400 py-8 text-center">
              No forecast data available. Add tasks and assignments to see the forecast.
            </div>
          )}
        </div>
      </div>

      {/* ── Recommended Actions ────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 pb-6">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <h2 className="text-base font-bold" style={{ color: "#0F2240" }}>
            Recommended Actions
          </h2>
          <p className="text-sm text-gray-500 mt-0.5 mb-5">
            Select an action to address capacity constraints.
          </p>

          <div className="grid grid-cols-5 gap-3">
            <ActionCard
              icon="📅"
              title="Adjust Timeline"
              description="Extend the deadline"
              onClick={() =>
                setToast("Navigate to Baseline to submit a revised deadline.")
              }
            />
            <ActionCard
              icon="👥"
              title="Add Resource"
              description="Increase capacity"
              to={`/projects/${id}/resource-assignment`}
            />
            <ActionCard
              icon="⇄"
              title="Reassign Work"
              description="Balance workload"
              to={`/projects/${id}/resource-assignment`}
            />
            <ActionCard
              icon="✂️"
              title="Reduce Scope"
              description="Adjust deliverables"
              to={`/projects/${id}/wbs`}
            />
            <ActionCard
              icon="🛡️"
              title="Approve with Risk"
              description="Accept and monitor"
              to={`/projects/${id}/baseline`}
            />
          </div>
        </div>
      </div>

      {/* ── Bottom action bar ──────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 pb-8">
        <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
          <Link
            to={`/projects/${id}/resource-assignment`}
            className="text-sm font-medium text-teal-600 hover:text-teal-700 flex items-center gap-1"
          >
            ← View Resource Assignment
          </Link>

          <Link
            to={`/projects/${id}/baseline`}
            className="text-sm font-semibold text-white px-5 py-2.5 rounded-lg transition hover:opacity-90"
            style={{ backgroundColor: "#0F2240" }}
          >
            Proceed to Baseline &amp; Approval →
          </Link>
        </div>
      </div>
    </div>
  );
}
