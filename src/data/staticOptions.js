// Fixed enums — not admin-configurable, since these follow a defined
// company framework rather than a free-form list like Job Titles.

export const PRIORITIES = ["Low", "Medium", "High"];

export const PROJECT_SOURCES = ["Intake Request", "L&D Initiative"];

export const DEVELOPMENT_TYPES = [
  {
    value: "Level 1",
    label: "Level 1 — Low",
    description:
      "Straightforward, familiar, low-risk. Limited planning, few decisions, uses existing templates/references/known processes.",
  },
  {
    value: "Level 2",
    label: "Level 2 — Moderate",
    description:
      "Focused work, some coordination, several decisions, but scope is manageable. May involve adapting existing materials, validating information, or select parts of ADDIE.",
  },
  {
    value: "Level 3",
    label: "Level 3 — High",
    description:
      "Complex, ambiguous, high-impact, or mentally demanding. Deep focus, sustained planning, significant coordination, often the full ADDIE cycle.",
  },
];

// Work Type -> suggested Delivery Format default (still editable by the user)
export const WORK_TYPE_DELIVERY_DEFAULTS = {
  "full-elearning": "E-Learning",
  "full-ilt-blended": "Blended",
};
