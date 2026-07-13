import { Link, useLocation } from "react-router-dom";

// ─── Step definitions ─────────────────────────────────────────────────────────

const STEPS = [
  { key: "wbs",      label: "WBS",                num: "1", path: "wbs"      },
  { key: "capacity", label: "Capacity Check",      num: "2", path: "capacity" },
  { key: "baseline", label: "Baseline & Approval", num: "3", path: "baseline" },
];

// Statuses that indicate each step is complete
const STEP_DONE_STATUSES = [
  ["WBS Pending", "Resource Check", "Pending Approval", "Active", "Done"], // WBS
  ["Pending Approval", "Active", "Done"],                                  // Capacity Check
  ["Active", "Done"],                                                      // Baseline
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function PlanningFlowNav({ project, projectId }) {
  const location = useLocation();
  const planningStatus = project?.planningStatus ?? "Draft / Intake";

  const currentStepIdx = STEPS.findIndex((s) =>
    location.pathname.endsWith("/" + s.path)
  );

  return (
    <div className="bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-6">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 pt-2.5 pb-1">
          <Link
            to={"/projects/" + projectId}
            className="text-[11px] text-gray-400 hover:text-teal-600 transition-colors flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {project ? (project.name || "Project") : "Project"}
          </Link>
          <span className="text-gray-300 text-[10px]">›</span>
          <span className="text-[11px] text-gray-500 font-medium">Resource Planning</span>
          {currentStepIdx >= 0 && (
            <>
              <span className="text-gray-300 text-[10px]">›</span>
              <span className="text-[11px] font-semibold" style={{ color: "#14B8A6" }}>
                {"Step " + (currentStepIdx + 1) + " of 3"}
              </span>
            </>
          )}
        </div>

        {/* Step tabs */}
        <div className="flex items-end overflow-x-auto -mb-px gap-0">
          {STEPS.map(function(step, idx) {
            const isDone    = STEP_DONE_STATUSES[idx].includes(planningStatus);
            const isCurrent = location.pathname.endsWith("/" + step.path);

            return (
              <Link
                key={step.key}
                to={"/projects/" + projectId + "/" + step.path}
                className={[
                  "flex items-center gap-1.5 px-4 py-2.5 text-[12px] font-medium border-b-2 transition-all whitespace-nowrap select-none",
                  isCurrent
                    ? "border-teal-500 text-teal-600 bg-teal-50/40"
                    : isDone
                    ? "border-transparent text-emerald-600 hover:border-emerald-300 hover:text-emerald-700"
                    : "border-transparent text-gray-400 hover:text-gray-600 hover:border-gray-200",
                ].join(" ")}
              >
                <span
                  className="flex-shrink-0 rounded-full flex items-center justify-center text-[9px] font-bold"
                  style={{
                    width: "18px",
                    height: "18px",
                    backgroundColor: isCurrent ? "#14B8A6" : isDone ? "#10b981" : "#e5e7eb",
                    color: (isCurrent || isDone) ? "#fff" : "#6b7280",
                  }}
                >
                  {isDone && !isCurrent ? (
                    <svg width="10" height="10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : step.num}
                </span>
                {step.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
