// Bandwidth bands — from Sandy's confirmed capacity model
export const BANDWIDTH_BANDS = [
  { max: 70,       label: "Available",   style: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500", dot: "bg-emerald-400" },
  { max: 90,       label: "Healthy",     style: "bg-teal-100 text-teal-700",       bar: "bg-teal-500",     dot: "bg-teal-400" },
  { max: 100,      label: "Full",        style: "bg-yellow-100 text-yellow-700",   bar: "bg-yellow-400",   dot: "bg-yellow-400" },
  { max: 110,      label: "At Risk",     style: "bg-orange-100 text-orange-700",   bar: "bg-orange-500",   dot: "bg-orange-400" },
  { max: Infinity, label: "Overloaded",  style: "bg-red-100 text-red-700",         bar: "bg-red-500",      dot: "bg-red-400" },
];

export function getBand(pct) {
  return BANDWIDTH_BANDS.find((b) => pct <= b.max) ?? BANDWIDTH_BANDS.at(-1);
}

/**
 * Compute a single user's bandwidth snapshot.
 *
 * Uses a 4-week rolling reference capacity so the number is always
 * comparable regardless of when you look:
 *   reference = dailyCapacityHours × workDaysPerWeek × 4
 *
 * Outstanding hours = sum of estimatedHours for all non-Done tasks assigned
 * to this user across all projects.  Utilisation % = outstanding / reference.
 */
export function computeUserBandwidth(allTasks, userId, workCalendar) {
  const { dailyCapacityHours = 8, workDaysPerWeek = 5 } = workCalendar || {};
  const referenceCapacity = dailyCapacityHours * workDaysPerWeek * 4;

  const assigned = allTasks.filter(
    (t) => t.assigneeId === userId && t.status !== "Done"
  );
  const outstandingHours = assigned.reduce((s, t) => s + (t.estimatedHours || 0), 0);
  const pct = referenceCapacity > 0 ? (outstandingHours / referenceCapacity) * 100 : 0;
  const clampedPct = Math.min(pct, 150); // cap visual bar at 150%

  return {
    outstandingHours,
    referenceCapacity,
    pct: Math.round(pct),
    clampedPct,
    band: getBand(pct),
    tasks: assigned,
  };
}

// ── Daily allocation helpers ──────────────────────────────────────────────────

/** Returns array of YYYY-MM-DD strings for Mon–Fri days in [startStr, endStr] */
export function getWorkingDaysInRange(startStr, endStr) {
  const days = [];
  const cur = new Date(startStr + "T00:00:00");
  const end = new Date(endStr  + "T00:00:00");
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/** Returns ALL calendar days (including weekends) in [startStr, endStr] */
export function getAllDaysInRange(startStr, endStr) {
  const days = [];
  const cur = new Date(startStr + "T00:00:00");
  const end = new Date(endStr   + "T00:00:00");
  while (cur <= end) {
    days.push({ date: cur.toISOString().slice(0, 10), isWeekend: cur.getDay() === 0 || cur.getDay() === 6 });
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

/**
 * For a single task, return a map of { [date]: hoursOnThatDay }.
 * Hours are distributed evenly across the task's working days.
 * Only returns days that fall within windowStart..windowEnd.
 */
function taskDailyHours(task, windowStart, windowEnd) {
  const tStart = task.startDate || task.dueDate;
  const tEnd   = task.dueDate   || task.startDate;
  if (!tStart || !tEnd || task.status === "Done" || task.status === "Canceled") return {};

  // Clamp to window
  const effectiveStart = tStart > windowStart ? tStart : windowStart;
  const effectiveEnd   = tEnd   < windowEnd   ? tEnd   : windowEnd;
  if (effectiveStart > effectiveEnd) return {};

  // Working days across the whole task (for hour distribution)
  const taskWorkDays = getWorkingDaysInRange(tStart, tEnd);
  if (taskWorkDays.length === 0) return {};

  const hrsPerDay = (task.estimatedHours || 0) / taskWorkDays.length;

  // Days within the window
  const windowDays = getWorkingDaysInRange(effectiveStart, effectiveEnd);
  const result = {};
  windowDays.forEach(d => { result[d] = hrsPerDay; });
  return result;
}

/**
 * Compute daily allocation for a user across a date window.
 * Returns { [date]: { hours: number, pct: number } }
 * where pct = hours / dailyCapacityHours * 100
 */
export function computeDailyAllocation(allTasks, userId, windowStart, windowEnd, dailyCapacityHours = 8) {
  const assigned = allTasks.filter(t => t.assigneeId === userId);
  const totals = {};

  assigned.forEach(task => {
    const daily = taskDailyHours(task, windowStart, windowEnd);
    Object.entries(daily).forEach(([date, hrs]) => {
      totals[date] = (totals[date] || 0) + hrs;
    });
  });

  const result = {};
  Object.entries(totals).forEach(([date, hours]) => {
    result[date] = {
      hours: Math.round(hours * 10) / 10,
      pct:   Math.round((hours / dailyCapacityHours) * 100),
    };
  });
  return result;
}
