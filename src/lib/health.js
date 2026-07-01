export const PROJECT_STATUS_GROUPS = {
  "To-do": ["Scoping", "Backlog", "Queued"],
  "In Progress": ["Planning", "Design", "Development", "Delivery", "Evaluation", "Paused"],
  Complete: ["Done", "Canceled", "Merged"],
};

export const PROJECT_STATUSES = Object.values(PROJECT_STATUS_GROUPS).flat();

const TODO_STATUSES = PROJECT_STATUS_GROUPS["To-do"];

export function computeHealth(project, completionPct) {
  const status = project.status || "Scoping";
  const start = project.startDate ? new Date(project.startDate) : null;
  // Deadline used for adherence math: approved revision > locked baseline > live proposed
  // baseline (max task due date) — so health stays meaningful even before a baseline is locked.
  const end =
    project.approvedRevisedEndDate || project.baselineEndDate || project.proposedBaselineEndDate;
  const endDate = end ? new Date(end) : null;
  const today = new Date();

  let adherence = null;
  if (start && endDate && endDate > start) {
    const expectedPct = Math.min(100, Math.max(0, ((today - start) / (endDate - start)) * 100));
    adherence = expectedPct > 0 ? (completionPct / expectedPct) * 100 : completionPct > 0 ? 100 : null;
  }

  // --- Terminal / manual-override states: always honored regardless of dates. ---
  if (status === "Canceled") return { label: "Canceled", style: "bg-gray-100 text-gray-500" };
  if (status === "Done" || status === "Merged" || completionPct >= 100) {
    return { label: "Done", style: "bg-emerald-100 text-emerald-700" };
  }
  if (status === "Paused") return { label: "Paused", style: "bg-gray-100 text-gray-600" };

  // --- Scoping: the default status at project creation. No baseline has been
  // locked yet, so there is nothing to measure schedule adherence against.
  // A project stays here on purpose until its baseline is approved — at which
  // point approveBaseline() auto-advances status to "Planning" and the normal
  // status/health rules below start applying. ---
  if (status === "Scoping") return { label: "Scoping", style: "bg-gray-100 text-gray-500" };

  // --- Data-integrity flag: work has started but status was never moved off the backlog. ---
  if (completionPct > 0 && TODO_STATUSES.includes(status)) {
    return { label: "Status Not Updated", style: "bg-amber-100 text-amber-800" };
  }
  if (status === "Backlog") return { label: "Backlog", style: "bg-gray-100 text-gray-500" };
  if (status === "Queued") return { label: "Queued", style: "bg-gray-100 text-gray-500" };

  // --- Not started: start date hasn't arrived and nothing has been logged yet. ---
  if (start && today < start && completionPct === 0) {
    return { label: "Not Started", style: "bg-gray-100 text-gray-500" };
  }

  // --- Deadline check runs BEFORE the "Planning" short-circuit on purpose.
  // Loophole this closes: a project left sitting in "Planning" status (or any
  // in-progress sub-stage) could blow past its own deadline and still show a
  // calm yellow "Planning" badge forever, because status alone gated the label.
  // Once the effective end date has passed and the project isn't done, the
  // real schedule state overrides whatever the manual status still says. ---
  if (endDate && today > endDate && completionPct < 100) {
    if (adherence !== null && adherence >= 90) {
      return { label: "Delayed — Near Completion", style: "bg-orange-100 text-orange-700" };
    }
    return { label: "Behind Schedule", style: "bg-red-100 text-red-700" };
  }

  if (status === "Planning") return { label: "Planning", style: "bg-yellow-100 text-yellow-700" };

  // --- No usable timeline yet (no start, no end, or baseline never proposed). ---
  if (adherence === null) return { label: "Scoping", style: "bg-gray-100 text-gray-500" };

  if (adherence >= 90) return { label: "On Track", style: "bg-emerald-100 text-emerald-700" };
  if (adherence >= 80) return { label: "At Risk", style: "bg-orange-100 text-orange-700" };
  return { label: "Behind Schedule", style: "bg-red-100 text-red-700" };
}
