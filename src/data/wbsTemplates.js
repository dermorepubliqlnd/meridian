// Meridian WBS Templates — source: PM_App_WBS_Templates_v1.docx
// Role codes: ID (Instructional Designer), Content Dev (Content Developer),
// LMS Admin, Supervisor (L&D Supervisor), Director (L&D Director), Trainer, SME

export const ROLE_LEGEND = {
  ID: "Instructional Designer",
  "Content Dev": "Content Developer",
  "LMS Admin": "Litmos Administrator (can be ID or Supervisor)",
  Supervisor: "L&D Supervisor",
  Director: "L&D Director",
  Trainer: "Trainer",
  SME: "Subject Matter Expert (internal or department)",
};

export const BLANK_TEMPLATE = {
  id: "blank",
  name: "Start from Blank",
  description: "No pre-loaded tasks \u2014 build your own task list from scratch on the project page.",
  phases: [],
};

export const WBS_TEMPLATES = [
  BLANK_TEMPLATE,
  {
    id: "full-elearning",
    name: "Full E-Learning Development",
    description: "Net-new SCORM or LMS-hosted e-learning course, built from scratch.",
    phases: [
      { phase: "Phase 1 — Analysis", tasks: [
        { name: "Discovery Session", notes: "Kickoff with stakeholder / SME; capture goals, audience, constraints", role: "ID / Director" },
        { name: "Collate Source Materials", notes: "Gather existing docs, SOPs, reference materials from requestor", role: "ID" },
        { name: "Development Timelines", notes: "Set baseline schedule; confirm resource assignment", role: "Supervisor / ID" },
      ]},
      { phase: "Phase 2 — Design", tasks: [
        { name: "Learning Objectives & Blueprint", notes: "Draft TLOs / ELOs; define course structure and assessment approach", role: "ID" },
        { name: "SME Review — Blueprint", notes: "SME validates learning objectives and content scope", role: "ID + SME" },
        { name: "Script / Storyboard", notes: "Full narration script or storyboard with interactions and visuals", role: "ID" },
        { name: "SME Review — Storyboard", notes: "SME reviews content accuracy; ID incorporates feedback", role: "ID + SME" },
        { name: "Design Approval", notes: "Director or requestor signs off on design before build begins", role: "Director" },
      ]},
      { phase: "Phase 3 — Development", tasks: [
        { name: "Alpha Build", notes: "First full e-learning build (slides, interactions, audio placeholder)", role: "Content Dev" },
        { name: "Internal QA Review", notes: "L&D team checks flow, accuracy, links, and interactions", role: "ID / Supervisor" },
        { name: "SME / Stakeholder Review", notes: "Alpha shared with SME and requestor for content sign-off", role: "ID + SME" },
        { name: "Revisions", notes: "Incorporate all approved feedback; document changes", role: "Content Dev" },
        { name: "Beta Build", notes: "Revised version with final audio, assets, and assessment", role: "Content Dev" },
        { name: "Final Approval", notes: "Requestor / Director approves beta for deployment", role: "Director" },
      ]},
      { phase: "Phase 4 — Deployment", tasks: [
        { name: "Course Creation in Litmos", notes: "Set up course shell, upload SCORM/content, configure settings", role: "LMS Admin" },
        { name: "Course Activation", notes: "Activate course; set completion rules and certificates", role: "LMS Admin" },
        { name: "Assign Learners", notes: "Enroll target audience; bulk assignment if applicable", role: "LMS Admin / Trainer" },
        { name: "Comms / Announcement", notes: "Send launch announcement to learners and managers", role: "Supervisor / ID" },
      ]},
      { phase: "Phase 5 — Evaluation", tasks: [
        { name: "Completion Tracking", notes: "Monitor completion rates at 2-week and 4-week marks", role: "LMS Admin" },
        { name: "Completion Report", notes: "Summarize completion rate, assessment scores, Level 1 feedback", role: "ID / Supervisor" },
        { name: "Digital File Turnover", notes: "Archive source files, storyboard, and Litmos assets", role: "Content Dev" },
      ]},
    ],
  },
  {
    id: "full-ilt-blended",
    name: "Full ILT / Blended Program",
    description: "Instructor-led or blended learning journey, designed from scratch.",
    phases: [
      { phase: "Phase 1 — Analysis", tasks: [
        { name: "Discovery Session", notes: "Kickoff with stakeholder / SME; capture goals, audience, prerequisites", role: "ID / Director" },
        { name: "Collate Existing Documents", notes: "Gather current materials, policies, SOPs related to the topic", role: "ID" },
        { name: "Development Timelines", notes: "Set baseline schedule; identify SMEs, trainers, venues", role: "Supervisor / ID" },
      ]},
      { phase: "Phase 2 — Design", tasks: [
        { name: "Learning Objectives & Outline", notes: "Draft TLOs / ELOs; define session structure, activities, assessments", role: "ID" },
        { name: "SME Review — Outline", notes: "SME validates accuracy and completeness of course outline", role: "ID + SME" },
        { name: "Design Approval", notes: "Director or requestor approves design before full development", role: "Director" },
      ]},
      { phase: "Phase 3 — Development", tasks: [
        { name: "Facilitator Guide", notes: "Full FG with session flow, talking points, timing, and debrief guides", role: "ID" },
        { name: "Participant Materials", notes: "Slide deck (PPT), workbook, job aids, handouts", role: "ID / Content Dev" },
        { name: "Assessment Development", notes: "Pre/post assessment or knowledge check aligned to ELOs", role: "ID" },
        { name: "SME Review — Materials", notes: "SME reviews all materials for accuracy; trainer reviews for usability", role: "ID + SME" },
        { name: "Revisions", notes: "Incorporate approved feedback; finalize all materials", role: "ID / Content Dev" },
        { name: "Director Approval", notes: "Final sign-off on complete materials package", role: "Director" },
      ]},
      { phase: "Phase 4 — Delivery Prep", tasks: [
        { name: "Cascade / Logistics", notes: "Coordinate venue, equipment, materials printing, catering if needed", role: "Supervisor / Trainer" },
        { name: "Endorsement to HR", notes: "Notify HR of training schedule; align with attendance records", role: "Supervisor" },
        { name: "Comms / Announcement", notes: "Send invite and pre-work instructions to participants and managers", role: "Supervisor / ID" },
      ]},
      { phase: "Phase 5 — Delivery", tasks: [
        { name: "Pilot Delivery", notes: "Run pilot session with sample audience; gather feedback", role: "Trainer / ID" },
        { name: "Post-Pilot Revisions", notes: "Refine materials based on pilot feedback", role: "ID" },
        { name: "Final Materials Turnover", notes: "Archive final FG, PPT, workbook, assessments in shared folder", role: "ID" },
      ]},
      { phase: "Phase 6 — Evaluation", tasks: [
        { name: "Attendance Tracking", notes: "Capture sign-in sheets or digital attendance; upload to LMS / records", role: "Trainer" },
        { name: "Assessment Scoring & Analysis", notes: "Compile pre/post scores; analyze gaps", role: "ID" },
        { name: "Completion Report", notes: "Summarize attendance, scores, Level 1 feedback, recommendations", role: "ID / Supervisor" },
      ]},
    ],
  },
  {
    id: "content-refresh",
    name: "Content Refresh / Update",
    description: "Updating existing training materials for policy or process changes.",
    phases: [
      { phase: "Phase 1 — Analysis", tasks: [
        { name: "Discovery / Scope Confirmation", notes: "Confirm what changed and what needs updating vs. what stays", role: "ID / Director" },
        { name: "Collate Existing Materials", notes: "Retrieve current versions of all materials to be updated", role: "ID" },
        { name: "Document / Content Mapping", notes: "Map old content to new requirements; flag gaps and deletions", role: "ID" },
        { name: "Development Timelines", notes: "Set baseline schedule based on scope of changes", role: "Supervisor / ID" },
      ]},
      { phase: "Phase 2 — Design", tasks: [
        { name: "Revised Outline / Scope", notes: "Update course outline to reflect new objectives and content structure", role: "ID" },
        { name: "SME Review — Scope", notes: "SME confirms the scope of updates is complete and accurate", role: "ID + SME" },
      ]},
      { phase: "Phase 3 — Development", tasks: [
        { name: "Content Updates", notes: "Edit script, slides, facilitator guide, or e-learning as needed", role: "ID / Content Dev" },
        { name: "SME Review — Updated Content", notes: "SME reviews revised content for accuracy and completeness", role: "ID + SME" },
        { name: "Revisions", notes: "Final round of edits based on SME feedback", role: "ID / Content Dev" },
        { name: "Approval", notes: "Director or requestor approves final updated content", role: "Director" },
      ]},
      { phase: "Phase 4 — Deployment", tasks: [
        { name: "LMS Update", notes: "Replace old version in Litmos; archive previous version", role: "LMS Admin" },
        { name: "Assign Learners / Recertify", notes: "Reassign to affected audience; set recertification rules if needed", role: "LMS Admin" },
        { name: "Comms / Announcement", notes: "Notify learners of updated content and any required re-completion", role: "Supervisor" },
      ]},
      { phase: "Phase 5 — Evaluation", tasks: [
        { name: "Completion Report", notes: "Track completion of updated course; note any issues", role: "ID" },
        { name: "Digital File Turnover", notes: "Archive updated source files; deprecate old versions", role: "Content Dev" },
      ]},
    ],
  },
  {
    id: "compliance-rollout",
    name: "Compliance Rollout",
    description: "Mandatory compliance training campaigns with completion deadlines.",
    phases: [
      { phase: "Phase 1 — Analysis", tasks: [
        { name: "Scope & Learner List", notes: "Confirm required audience, deadline, and regulatory basis", role: "Director / Supervisor" },
        { name: "Content Validation", notes: "Legal, Compliance, or HR confirms content accuracy before deployment", role: "ID + Compliance" },
        { name: "Development Timelines", notes: "Set rollout schedule aligned to compliance deadline", role: "Supervisor" },
      ]},
      { phase: "Phase 2 — Development (if needed)", tasks: [
        { name: "Content Development", notes: "Build or adapt content (skip if using existing approved module)", role: "ID / Content Dev" },
        { name: "Approval", notes: "Director + Compliance / Legal sign-off on final content", role: "Director" },
      ]},
      { phase: "Phase 3 — Deployment", tasks: [
        { name: "Course Setup in Litmos", notes: "Create course shell, upload content, configure completion rules", role: "LMS Admin" },
        { name: "Course Activation", notes: "Activate and test course; verify certificate settings", role: "LMS Admin" },
        { name: "Bulk Learner Assignment", notes: "Enroll all required learners via bulk upload or learning path", role: "LMS Admin" },
        { name: "Comms / Announcement", notes: "Send mandatory training notice with deadline to all learners", role: "Supervisor / ID" },
        { name: "Certificate Setup", notes: "Ensure completion certificates are configured and auto-issued", role: "LMS Admin" },
      ]},
      { phase: "Phase 4 — Monitoring", tasks: [
        { name: "Completion Tracking", notes: "Weekly monitoring of completion rates against deadline", role: "Supervisor / LMS Admin" },
        { name: "Escalation Comms", notes: "Send reminders to non-completers and flag to line managers", role: "Supervisor" },
        { name: "Endorsement to HR", notes: "Submit completion report to HR for compliance records", role: "Supervisor" },
      ]},
      { phase: "Phase 5 — Evaluation", tasks: [
        { name: "Completion Report", notes: "Final report: completion rate, scores, non-completers, recommendations", role: "ID / Supervisor" },
      ]},
    ],
  },
  {
    id: "simple-request",
    name: "Simple Request / Admin Task",
    description: "Low-complexity requests: one-off materials, LMS admin tasks, quick reports.",
    phases: [
      { phase: "Phase 1 — Setup", tasks: [
        { name: "Scope Confirmation", notes: "Clarify the request, expected output, and deadline with requestor", role: "Supervisor / ID" },
        { name: "Resource Assignment", notes: "Assign to team member; confirm availability", role: "Supervisor" },
      ]},
      { phase: "Phase 2 — Execution", tasks: [
        { name: "Execute / Build Deliverable", notes: "Complete the task or material as scoped", role: "Assigned Member" },
        { name: "Self-Review", notes: "Team member reviews output before submission", role: "Assigned Member" },
      ]},
      { phase: "Phase 3 — Close", tasks: [
        { name: "Stakeholder Review", notes: "Share deliverable with requestor for review and sign-off", role: "Supervisor" },
        { name: "Revisions (if needed)", notes: "Minor edits based on feedback", role: "Assigned Member" },
        { name: "Endorsement / Handoff", notes: "Deliver final output to requestor; confirm receipt", role: "Supervisor" },
        { name: "Completion", notes: "Mark project complete; file deliverable in shared folder", role: "Supervisor" },
      ]},
    ],
  },
];
