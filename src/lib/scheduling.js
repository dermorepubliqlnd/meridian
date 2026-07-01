// Meridian task scheduling — MVP version.
//
// Rule: Date Span (working days) = ceil(Estimated Hours / Daily Capacity).
// Tasks are scheduled sequentially in WBS order (each starts the working day
// after the previous task's due date) since no dependency graph UI exists
// yet beyond template order. Weekends are skipped. Holidays and per-person
// time off are NOT yet factored in — that lands with the Resources module,
// which is where daily capacity and the holiday calendar will actually live.
// Until then every assignee defaults to an 8-hour day.

export const DEFAULT_DAILY_CAPACITY_HOURS = 8;

function isWeekend(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function addWorkingDays(date, days) {
  const result = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    if (!isWeekend(result)) remaining -= 1;
  }
  return result;
}

function nextWorkingDay(date) {
  const result = new Date(date);
  result.setDate(result.getDate() + 1);
  while (isWeekend(result)) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

function toISO(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Computes start/due dates for an ordered list of tasks.
 * @param {Array} tasks - ordered tasks, each optionally with estimatedHours
 * @param {string} projectStartDateISO - "YYYY-MM-DD"
 * @param {number} dailyCapacityHours - hours/day for the assignee (defaults to 8)
 * @returns {Array} tasks with startDate/dueDate (ISO strings) added, or null if
 *   estimatedHours isn't set yet for that task.
 */
export function computeSchedule(tasks, projectStartDateISO, dailyCapacityHours = DEFAULT_DAILY_CAPACITY_HOURS) {
  let cursor = projectStartDateISO ? new Date(projectStartDateISO) : new Date();
  let hasStarted = false;

  return tasks.map((task) => {
    if (!task.estimatedHours || task.estimatedHours <= 0) {
      return { ...task, startDate: null, dueDate: null };
    }

    const capacity = task.dailyCapacityHours || dailyCapacityHours;
    const spanDays = Math.max(1, Math.ceil(task.estimatedHours / capacity));

    const start = hasStarted ? nextWorkingDay(cursor) : cursor;
    const due = addWorkingDays(start, spanDays - 1);

    cursor = due;
    hasStarted = true;

    return { ...task, startDate: toISO(start), dueDate: toISO(due) };
  });
}
