// ── Capacity bands — from Phase 1 brief (capacity-based model) ────────────────
// Thresholds are % of available PROJECT hours (not total working hours)
export const BANDWIDTH_BANDS = [
  { max: 60,       label: "Available",         style: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500", dot: "bg-emerald-400" },
  { max: 85,       label: "Healthy",           style: "bg-teal-100 text-teal-700",       bar: "bg-teal-500",    dot: "bg-teal-400"    },
  { max: 100,      label: "Fully Allocated",   style: "bg-yellow-100 text-yellow-700",   bar: "bg-yellow-400",  dot: "bg-yellow-400"  },
  { max: 120,      label: "Overallocated",     style: "bg-orange-100 text-orange-700",   bar: "bg-orange-500",  dot: "bg-orange-400"  },
  { max: Infinity, label: "Critical Overload", style: "bg-red-100 text-red-700",         bar: "bg-red-500",     dot: "bg-red-400"     },
];

export function getBand(pct) {
  return BANDWIDTH_BANDS.find((b) => pct <= b.max) ?? BANDWIDTH_BANDS.at(-1);
}

// ── Per-user capacity helpers ─────────────────────────────────────────────────
//
// Phase 1 model:
//   Weekly project hours = weeklyHours × projectCapacityPct
//   Daily project capacity = weeklyProjectHours / workDaysPerWeek
//
// Defaults (if fields not yet set on user profile):
//   weeklyHours        = 37.5  (standard PH work week)
//   projectCapacityPct = 60%   (realistic — remainder is BAU, meetings, admin)

export function userWeeklyProjectHours(userProfile) {
  const weeklyHours = userProfile?.weeklyHours ?? 37.5;
  const pct         = (userProfile?.projectCapacityPct ?? 60) / 100;
  return weeklyHours * pct;
}

export function userDailyProjectCapacity(userProfile, workDaysPerWeek = 5) {
  return userWeeklyProjectHours(userProfile) / workDaysPerWeek;
}

/**
 * Compute a single user's bandwidth snapshot (rolling 4-week reference).
 *
 * Phase 1: uses per-user weekly project hours as the capacity denominator,
 * so % reflects utilisation of available project time — not total work time.
 *
 * Falls back to global workCalendar.dailyCapacityHours if no user profile supplied
 * (backward-compatible with older call sites).
 */
export function computeUserBandwidth(allTasks, userId, workCalendar, userProfile) {
  const { workDaysPerWeek = 5 } = workCalendar || {};

  const weeklyProjectHours = userProfile
    ? userWeeklyProjectHours(userProfile)
    : (workCalendar?.dailyCapacityHours ?? 7.5) * workDaysPerWeek;

  const referenceCapacity = weeklyProjectHours * 4; // 4-week rolling window

  const assigned = allTasks.filter(
    (t) => t.assigneeId === userId && t.status !== "Done"
  );
  const outstandingHours = assigned.reduce((s, t) => s + (t.estimatedHours || 0), 0);
  const pct = referenceCapacity > 0 ? (outstandingHours / referenceCapacity) * 100 : 0;

  return {
    outstandingHours,
    referenceCapacity,
    weeklyProjectHours,
    pct: Math.round(pct),
    clampedPct: Math.min(pct, 150),
    band: getBand(pct),
    tasks: assigned,
  };
}

// ── Daily allocation helpers ──────────────────────────────────────────────────

// Use local date string to avoid UTC timezone shift (critical for UTC+8 PH timezone)
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Returns array of YYYY-MM-DD strings for Mon–Fri days in [startStr, endStr] */
export function getWorkingDaysInRange(startStr, endStr) {
  const days = [];
  const cur = new Date(startStr + "T00:00:00");
  const end = new Date(endStr   + "T00:00:00");
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) days.push(localDateStr(cur));
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
    const dow = cur.getDay();
    days.push({ date: localDateStr(cur), isWeekend: dow === 0 || dow === 6 });
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

  const effectiveStart = tStart > windowStart ? tStart : windowStart;
  const effectiveEnd   = tEnd   < windowEnd   ? tEnd   : windowEnd;
  if (effectiveStart > effectiveEnd) return {};

  const taskWorkDays = getWorkingDaysInRange(tStart, tEnd);
  if (taskWorkDays.length === 0) return {};

  const hrsPerDay  = (task.estimatedHours || 0) / taskWorkDays.length;
  const windowDays = getWorkingDaysInRange(effectiveStart, effectiveEnd);
  const result = {};
  windowDays.forEach(d => { result[d] = hrsPerDay; });
  return result;
}

/**
 * Compute daily allocation for a user across a date window.
 * Returns { [date]: { hours: number, pct: number } }
 *
 * Phase 1: pct is now relative to the user's daily PROJECT capacity
 * (weeklyHours × projectCapacityPct / workDaysPerWeek), not their full workday.
 *
 * Pass userProfile to enable per-user capacity; falls back to dailyCapacityHours
 * if not supplied (backward-compatible).
 */
export function computeDailyAllocation(allTasks, userId, windowStart, windowEnd, dailyCapacityHours = 7.5, userProfile = null) {
  const effectiveDailyCap = userProfile
    ? userDailyProjectCapacity(userProfile)
    : dailyCapacityHours;

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
      pct:   Math.round((hours / effectiveDailyCap) * 100),
    };
  });
  return result;
}
