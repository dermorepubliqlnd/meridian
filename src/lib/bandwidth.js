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
