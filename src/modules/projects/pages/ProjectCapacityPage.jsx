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
  serverTimestamp,
  getDoc,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { userWeeklyProjectHours } from "../../../lib/bandwidth";

// ─── Constants ───────────────────────────────────────────────────────────────

const PLANNING_WINDOW_OPTIONS = [4, 8, 12, 16];

// Compute project duration in weeks from startDate → targetLaunchDate (rounded up, min 1)
function projectDurationWeeks(project) {
  if (!project?.startDate || !project?.targetLaunchDate) return 8;
  const start = new Date(project.startDate + "T00:00:00");
  const end   = new Date(project.targetLaunchDate + "T00:00:00");
  const days  = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.ceil(days / 7));
}

const DEFAULT_PLANNING_WEEKS = null; // set from project duration on load

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
  const [planningWeeks, setPlanningWeeks] = useState(null);
  const [toast, setToast] = useState(null);
  const [markingChecked, setMarkingChecked] = useState(false);
  const [allProjects, setAllProjects] = useState(null);
  const [holidays,    setHolidays]    = useState([]);

  // Firestore subscriptions
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "projects", id), (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        setProject({ id: snap.id, ...data });
        setPlanningWeeks((prev) => prev ?? (data.planningWeeks || projectDurationWeeks({ ...data })));
      } else {
        setProject(null);
      }
    });
    return unsub;
  }, [id]);

  // Load holidays from Admin Settings
  useEffect(() => {
    getDoc(doc(db, "settings", "workCalendar")).then((snap) => {
      if (snap.exists()) setHolidays(snap.data().holidays || []);
    }).catch(() => {});
  }, []);

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
      // Flatten assignees array into individual records for capacity calc
      const flat = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        const role = data.role || d.id;
        if (data.assignees?.length) {
          data.assignees.forEach((slot) => {
            if (slot.userId) flat.push({ id: `${d.id}-${slot.slotId}`, role, userId: slot.userId, allocationPct: slot.allocationPct ?? 20 });
          });
        } else if (data.userId) {
          // Legacy single-assignee format
          flat.push({ id: d.id, role, userId: data.userId, allocationPct: data.allocationPct ?? 20 });
        }
      });
      setAssignments(flat);
    });
    return unsub;
  }, [id]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "projects"), (snap) => {
      setAllProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

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

  // Cross-project ownership counts per user (excludes current project)
  const ownerCounts = useMemo(() => {
    if (!allProjects) return {};
    const active = ["Draft / Intake", "WBS Pending", "Resource Check", "Pending Approval", "Active"];
    const counts = {};
    for (const p of allProjects) {
      if (p.id === id) continue;
      if (p.ownerId && (active.includes(p.planningStatus) || active.includes(p.status))) {
        counts[p.ownerId] = (counts[p.ownerId] || 0) + 1;
      }
    }
    return counts;
  }, [allProjects, id]);

  // Per-person capacity data
  const personCapacity = useMemo(() => {
    if (!assignments || !users) return [];

    return assignments.filter((asgn) => asgn.userId).map((asgn) => {
      const user = users.find((u) => u.id === asgn.userId) || {};
      // Subtract public holidays that fall within the planning window
      const projStart = project?.startDate;
      const holidayCount = projStart && planningWeeks
        ? holidays.filter((h) => {
            const end = new Date(projStart + "T00:00:00");
            end.setDate(end.getDate() + planningWeeks * 7);
            return h.date >= projStart && h.date <= end.toISOString().slice(0, 10);
          }).length
        : 0;
      const effectiveWeeks = Math.max(0, planningWeeks - holidayCount / 5);
      const availableHrs = userWeeklyProjectHours(user) * effectiveWeeks;
      // New model: allocationPct = % of weekly capacity committed to this project
      const allocationFactor = (asgn.allocationPct || 20) / 100;
      const hoursNeeded = allocationFactor * userWeeklyProjectHours(user) * effectiveWeeks;
      const gap = availableHrs - hoursNeeded;
      const status = capacityStatus(gap);

      return {
        assignmentId: asgn.id,
        userId: asgn.userId,
        name: user.name || "Unknown",
        jobTitle: user.jobTitle || "",
        role: asgn.role,
        allocationPct: asgn.allocationPct || 20,
        availableHrs,
        hoursNeeded,
        gap,
        status,
        isProjectOwner: asgn.userId === project?.ownerId,
        ownerCount: ownerCounts[asgn.userId] || 0,
      };
    });
  }, [assignments, users, hoursByRole, planningWeeks, project, ownerCounts]);

  // Summary stats
  const summaryStats = useMemo(() => {
    const overallocated = personCapacity.filter((p) => p.gap < 0).length;
    const limited = personCapacity.filter((p) => p.gap >= 0 && p.gap <= 5).length;
    const wbsEffortHrs = topLevelTasks.reduce((s, t) => s + (Number(t.estimatedHours) || 0), 0);
    const committedHrs  = personCapacity.reduce((s, p) => s + p.hoursNeeded, 0);
    const totalAvailable = personCapacity.reduce((s, p) => s + p.availableHrs, 0);
    const capacityGap = totalAvailable - wbsEffortHrs;
    return { overallocated, limited, wbsEffortHrs, committedHrs, totalAvailable, capacityGap };
  }, [personCapacity, topLevelTasks]);

  // Top 3 risks (most overallocated first)
  const topRisks = useMemo(() => {
    // Only flag people who are actually overallocated (negative gap)
    return [...personCapacity]
      .filter((p) => p.gap < 0)
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

  const { overallocated, limited, wbsEffortHrs, committedHrs, totalAvailable, capacityGap } = summaryStats;
  const progressPct =
    totalAvailable > 0 ? Math.min(100, (wbsEffortHrs / totalAvailable) * 100) : 0;
  const progressColor =
    capacityGap < 0 ? "bg-red-500" : capacityGap <= 5 ? "bg-amber-400" : "bg-emerald-500";

  const overallocatedPeople = personCapacity.filter((p) => p.gap < 0);

  return (
    <div className="min-h-screen bg-gray-50">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <PlanningFlowNav project={project} projectId={id} />
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">

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
                value={planningWeeks ?? ""}
                onChange={async (e) => {
                  const val = Number(e.target.value);
                  setPlanningWeeks(val);
                  await updateDoc(doc(db, "projects", id), { planningWeeks: val });
                }}
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

      </div>

      {/* ── Action banner: Mark Capacity Checked ───────────────────────── */}
      {project.planningStatus === "Resource Check" && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-[13px] font-semibold text-emerald-800">Ready to proceed to Baseline &amp; Approval?</p>
                <p className="text-[12px] text-emerald-600 mt-0.5">
                  Once you've reviewed the resource gaps and confirmed the team can handle this project, mark it as checked to unlock baseline submission.
                </p>
              </div>
            </div>
            <button
              onClick={handleMarkCapacityChecked}
              disabled={markingChecked}
              className="flex items-center gap-2 text-[13px] font-semibold px-5 py-2.5 rounded-lg text-white shadow-sm transition hover:opacity-90 disabled:opacity-50 flex-shrink-0"
              style={{ backgroundColor: "#0F2240" }}
            >
              {markingChecked ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  Updating…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Mark Capacity Checked
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Already checked banner */}
      {project.planningStatus === "Pending Approval" && (
        <div className="border-b border-blue-200 bg-blue-50 px-6 py-3">
          <div className="max-w-7xl mx-auto flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-[12px] text-blue-700 font-medium">Capacity checked — baseline submission is now open.</p>
          </div>
        </div>
      )}

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
              <span className="text-gray-500">WBS Effort Required</span>
              <span className="font-bold text-gray-800">{wbsEffortHrs.toFixed(1)} hrs</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500" title="Sum of each person's allocation % × their capacity over the planning window">Total Committed Hours</span>
              <span className="font-bold text-gray-800">{committedHrs.toFixed(1)} hrs</span>
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

      {/* ── Per-Person Capacity Breakdown ─────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 pb-5">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-bold" style={{ color: "#0F2240" }}>Per-Person Capacity Breakdown</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">
                Compares what this project needs from each person vs. their realistic available capacity (based on their project capacity % setting).
              </p>
            </div>
          </div>
          <table className="w-full text-[12px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                {["Person", "Role", "Project Demand", "Capacity Pool (" + planningWeeks + "wk)", "Pool Utilization", "Remaining", "Status"].map((h) => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {personCapacity.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400 text-[12px]">No assignments yet. Assign team members in Resource Assignment first.</td></tr>
              ) : personCapacity.map((p) => {
                const poolUtilPct = p.availableHrs > 0 ? Math.round((p.hoursNeeded / p.availableHrs) * 100) : 0;
                const barColor = poolUtilPct > 100 ? "bg-red-500" : poolUtilPct > 85 ? "bg-amber-400" : poolUtilPct > 60 ? "bg-teal-400" : "bg-emerald-400";
                const statusCls = p.gap < 0 ? "bg-red-100 text-red-700" : p.gap <= 5 ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700";
                const statusLabel = p.gap < 0 ? "Overallocated" : p.gap <= 5 ? "Tight" : "Available";
                return (
                  <tr key={p.assignmentId} className="hover:bg-gray-50/50">
                    {/* Person */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0" style={{ backgroundColor: "#14B8A6" }}>
                          {(p.name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)}
                        </div>
                        <div>
                          <span className="font-medium text-gray-800">{p.name}</span>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {p.isProjectOwner && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                                👑 Project Owner
                              </span>
                            )}
                            {p.ownerCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold bg-orange-50 text-orange-600 border border-orange-200 px-1.5 py-0.5 rounded-full">
                                ⚠ Owns {p.ownerCount} other active project{p.ownerCount > 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* Role */}
                    <td className="px-4 py-3 text-gray-500">{p.role}</td>
                    {/* Project Demand */}
                    <td className="px-4 py-3">
                      <span className="font-semibold text-navy">{p.hoursNeeded.toFixed(1)}h</span>
                      <div className="text-[10px] text-gray-400">this project needs</div>
                    </td>
                    {/* Capacity Pool */}
                    <td className="px-4 py-3">
                      <span className="font-semibold text-gray-700">{p.availableHrs.toFixed(1)}h</span>
                      <div className="text-[10px] text-gray-400">{(p.availableHrs / planningWeeks).toFixed(1)}h/wk available</div>
                    </td>
                    {/* Pool Utilization */}
                    <td className="px-4 py-3 min-w-[140px]">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(poolUtilPct, 100)}%` }} />
                        </div>
                        <span className="text-[11px] font-semibold text-gray-700 w-8 text-right">{poolUtilPct}%</span>
                      </div>
                      <div className="text-[10px] text-gray-400 mt-0.5">of {planningWeeks}-wk pool</div>
                    </td>
                    {/* Remaining */}
                    <td className="px-4 py-3">
                      <span className={`font-semibold ${p.gap < 0 ? "text-red-600" : "text-emerald-600"}`}>
                        {p.gap >= 0 ? "+" : ""}{p.gap.toFixed(1)}h
                      </span>
                      <div className="text-[10px] text-gray-400">for other projects</div>
                    </td>
                    {/* Status */}
                    <td className="px-4 py-3">
                      <span className={`inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusCls}`}>{statusLabel}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {personCapacity.length > 0 && (
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 text-[11px] text-gray-500 flex gap-6">
              <span>Total project demand: <strong className="text-gray-700">{wbsEffortHrs.toFixed(1)}h</strong></span>
              <span>Combined pool ({planningWeeks}wk): <strong className="text-gray-700">{totalAvailable.toFixed(1)}h</strong></span>
              <span>Avg pool utilization: <strong className={wbsEffortHrs/totalAvailable > 0.9 ? "text-red-600" : wbsEffortHrs/totalAvailable > 0.6 ? "text-amber-600" : "text-emerald-600"}>{Math.round((wbsEffortHrs/totalAvailable)*100)}%</strong></span>
            </div>
          )}
        </div>
      </div>

      {/* ── Recommended Actions — only when actual constraints exist ── */}
      {(summaryStats.overallocated > 0 || topRisks.length > 0) && (
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
              to={`/projects/${id}/role-demand`}
            />
            <ActionCard
              icon="⇄"
              title="Reassign Work"
              description="Balance workload"
              to={`/projects/${id}/role-demand`}
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
      )}

      {/* ── Bottom action bar ──────────────────────────────────────────── */}
      <div className="max-w-7xl mx-auto px-6 pb-8">
        <div className="flex items-center justify-end bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
          {project.planningStatus === "Resource Check" ? (
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-amber-600 font-medium">
                ⚠ Mark capacity as checked above before proceeding.
              </span>
              <button
                disabled
                className="text-sm font-semibold text-white px-5 py-2.5 rounded-lg opacity-40 cursor-not-allowed"
                style={{ backgroundColor: "#0F2240" }}
              >
                Proceed to Baseline &amp; Approval →
              </button>
            </div>
          ) : (
            <Link
              to={`/projects/${id}/baseline`}
              className="text-sm font-semibold text-white px-5 py-2.5 rounded-lg transition hover:opacity-90"
              style={{ backgroundColor: "#0F2240" }}
            >
              Proceed to Baseline &amp; Approval →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
