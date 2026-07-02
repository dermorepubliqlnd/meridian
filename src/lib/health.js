// ── Project Status (lifecycle) ────────────────────────────────────────────────
export const PROJECT_STATUSES = ["Not Started", "Active", "On Hold", "Done", "Canceled"];

export const STATUS_STYLES = {
  "Not Started": "bg-gray-100 text-gray-500 border border-gray-200",
  "Active":      "bg-blue-100 text-blue-700 border border-blue-200",
  "On Hold":     "bg-amber-100 text-amber-700 border border-amber-200",
  "Done":        "bg-emerald-100 text-emerald-700 border border-emerald-200",
  "Canceled":    "bg-gray-100 text-gray-400 border border-gray-200",
};

// ── Project Phase (ADDIE stage) ───────────────────────────────────────────────
export const PROJECT_PHASES = [
  "Scoping",
  "Planning",
  "Design",
  "Development",
  "Review",
  "Implementation",
  "Evaluation",
];

export const PHASE_STYLES = {
  "Scoping":        "bg-slate-100 text-slate-600",
  "Planning":       "bg-yellow-100 text-yellow-700",
  "Design":         "bg-purple-100 text-purple-700",
  "Development":    "bg-blue-100 text-blue-700",
  "Review":         "bg-orange-100 text-orange-700",
  "Implementation": "bg-teal-100 text-teal-700",
  "Evaluation":     "bg-emerald-100 text-emerald-700",
};

// ── Legacy status → new status + phase mapping (for existing projects) ────────
export function migrateLegacyStatus(oldStatus) {
  const map = {
    "Scoping":    { status: "Active",       phase: "Scoping" },
    "Backlog":    { status: "Not Started",  phase: "Scoping" },
    "Queued":     { status: "Not Started",  phase: "Scoping" },
    "Planning":   { status: "Active",       phase: "Planning" },
    "Design":     { status: "Active",       phase: "Design" },
    "Development":{ status: "Active",       phase: "Development" },
    "Delivery":   { status: "Active",       phase: "Implementation" },
    "Evaluation": { status: "Active",       phase: "Evaluation" },
    "Paused":     { status: "On Hold",      phase: "Development" },
    "Done":       { status: "Done",         phase: "Evaluation" },
    "Merged":     { status: "Done",         phase: "Evaluation" },
    "Canceled":   { status: "Canceled",     phase: "Scoping" },
  };
  return map[oldStatus] || { status: "Active", phase: "Scoping" };
}

// ── Health (RAG) ──────────────────────────────────────────────────────────────
// Returns { label, rag: "green"|"amber"|"red"|"grey", style, isOverridden }
export function computeHealth(project, completionPct) {
  const status = project.status || "Not Started";
  const phase  = project.phase  || "Scoping";

  // Manual override — owner/admin can set RAG with a note
  if (project.healthOverride) {
    const { rag } = project.healthOverride;
    return {
      label: rag === "green" ? "On Track" : rag === "amber" ? "At Risk" : "Behind Schedule",
      rag,
      style: RAG_STYLES[rag],
      isOverridden: true,
    };
  }

  // Terminal / inactive states
  if (status === "Canceled")     return { label: "Canceled",    rag: "grey",  style: RAG_STYLES.grey,  isOverridden: false };
  if (status === "Done" || completionPct >= 100)
                                  return { label: "Done",        rag: "grey",  style: RAG_STYLES.grey,  isOverridden: false };
  if (status === "On Hold")       return { label: "On Hold",     rag: "grey",  style: RAG_STYLES.grey,  isOverridden: false };
  if (status === "Not Started")   return { label: "Not Started", rag: "grey",  style: RAG_STYLES.grey,  isOverridden: false };

  // Active project — compute adherence
  const start   = project.startDate ? new Date(project.startDate) : null;
  const end     = project.approvedRevisedEndDate || project.baselineEndDate || project.proposedBaselineEndDate;
  const endDate = end ? new Date(end) : null;
  const today   = new Date();

  // No timeline yet → Scoping phase, can't measure
  if (!start || !endDate || endDate <= start) {
    return { label: "Scoping", rag: "grey", style: RAG_STYLES.grey, isOverridden: false };
  }

  // Past deadline and not done
  if (today > endDate && completionPct < 100) {
    const expectedPct = 100;
    const adherence   = completionPct / expectedPct * 100;
    if (adherence >= 85) return { label: "Delayed — Near Completion", rag: "amber", style: RAG_STYLES.amber, isOverridden: false };
    return { label: "Behind Schedule", rag: "red", style: RAG_STYLES.red, isOverridden: false };
  }

  // Within timeline
  const expectedPct = Math.min(100, Math.max(0, ((today - start) / (endDate - start)) * 100));
  if (expectedPct === 0) {
    return { label: "Not Started", rag: "grey", style: RAG_STYLES.grey, isOverridden: false };
  }
  const adherence = (completionPct / expectedPct) * 100;

  if (adherence >= 90) return { label: "On Track",        rag: "green", style: RAG_STYLES.green, isOverridden: false };
  if (adherence >= 75) return { label: "At Risk",         rag: "amber", style: RAG_STYLES.amber, isOverridden: false };
  return                      { label: "Behind Schedule", rag: "red",   style: RAG_STYLES.red,   isOverridden: false };
}

export const RAG_STYLES = {
  green: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  amber: "bg-amber-100 text-amber-700 border border-amber-200",
  red:   "bg-red-100 text-red-700 border border-red-200",
  grey:  "bg-gray-100 text-gray-500 border border-gray-200",
};

// Keep this exported for any code still importing PROJECT_STATUS_GROUPS
export const PROJECT_STATUS_GROUPS = {
  "Lifecycle": PROJECT_STATUSES,
  "Phases":    PROJECT_PHASES,
};
