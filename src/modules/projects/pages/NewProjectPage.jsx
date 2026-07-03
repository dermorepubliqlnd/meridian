import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  collection,
  onSnapshot,
  addDoc,
  writeBatch,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { WBS_TEMPLATES, LEAP_ANALYSIS, LEAP_PHASE_LIBRARY } from "../../../data/wbsTemplates";
import {
  PRIORITIES,
  PROJECT_SOURCES,
  DEVELOPMENT_TYPES,
  WORK_TYPE_DELIVERY_DEFAULTS,
} from "../../../data/staticOptions";
import { useSettingsList } from "../../../lib/useSettingsList";
import { generateProjectCode } from "../../../lib/projectCode";

const DEFAULT_TRAINING_TYPES = [
  "Onboarding", "Compliance & Safety", "Technical & Systems", "Leadership",
  "Professional Development", "Operational Support", "L&D Improvements",
];
const DEFAULT_DELIVERY_FORMATS = ["Face-to-Face ILT", "Virtual ILT", "Blended", "E-Learning"];

const DEADLINE_FLEXIBILITY_OPTIONS = [
  { value: "Fixed",      label: "Fixed",      desc: "Date cannot move under any circumstance." },
  { value: "Flexible",   label: "Flexible",   desc: "Date can shift slightly if resource capacity requires it." },
  { value: "Negotiable", label: "Negotiable", desc: "Date is a preference and can be discussed with the requestor." },
];

const DEADLINE_DRIVER_OPTIONS = [
  "Compliance",
  "Leadership Request",
  "Product Launch",
  "Operational Need",
  "Campaign",
  "Other",
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function Req() {
  return <span className="text-red-500 ml-0.5">*</span>;
}

function SectionHeader({ number, title, subtitle }) {
  return (
    <div className="flex items-start gap-3 mb-3">
      <div className="w-6 h-6 rounded-full bg-navy text-white flex items-center justify-center text-[11px] font-bold shrink-0 mt-0.5">
        {number}
      </div>
      <div>
        <div className="text-[13px] font-semibold text-navy">{title}</div>
        {subtitle && <div className="text-[11px] text-gray-400 mt-0.5">{subtitle}</div>}
      </div>
    </div>
  );
}

function FieldGroup({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-lg shadow-sm border border-gray-100 p-4 ${className}`}>
      {children}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function NewProjectPage() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [users, setUsers] = useState([]);
  const [trainingTypes]   = useSettingsList("trainingTypes",   DEFAULT_TRAINING_TYPES);
  const [deliveryFormats] = useSettingsList("deliveryFormats", DEFAULT_DELIVERY_FORMATS);
  const [departments]     = useSettingsList("departments", [
    "Finance","Human Resources","Information Technology","Learning & Development",
    "Marketing","Operations","Production","Quality Assurance","Sales","Supply Chain","Warehouse",
  ]);

  const [form, setForm] = useState({
    name:                "",
    ticketNumber:        "",
    description:         "",
    source:              PROJECT_SOURCES[0],
    requestorName:       "",
    requestorDepartment: "",
    priority:            "Medium",
    templateId:          WBS_TEMPLATES[0].id,
    trainingType:        "",
    developmentType:     DEVELOPMENT_TYPES[0].value,
    deliveryFormat:      "",
    startDate:           "",
    targetLaunchDate:    "",
    deadlineFlexibility: "Flexible",
    deadlineDriver:      "",
    ownerId:             "",
    approverId:          "",
    memberIds:           [],
    folderUrl:           "",
    smeName:             "",
  });

  const [leapPhases,      setLeapPhases]      = useState({ Learn: true, Engage: false, Apply: false, Prove: false });
  const [deliveryTouched, setDeliveryTouched] = useState(false);
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState("");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  const selectedTemplate = WBS_TEMPLATES.find((t) => t.id === form.templateId);
  const isLeap = selectedTemplate.isLeap;
  const effectivePhases = isLeap
    ? [LEAP_ANALYSIS, ...Object.entries(leapPhases).filter(([, on]) => on).map(([name]) => LEAP_PHASE_LIBRARY[name])]
    : selectedTemplate.phases;
  const totalTasks = effectivePhases.reduce((n, p) => n + p.tasks.length, 0);

  useEffect(() => {
    if (deliveryTouched) return;
    const suggested = WORK_TYPE_DELIVERY_DEFAULTS[form.templateId];
    if (suggested) setForm((f) => ({ ...f, deliveryFormat: suggested }));
  }, [form.templateId, deliveryTouched]);

  const toggleMember = (uid) => {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(uid)
        ? f.memberIds.filter((id) => id !== uid)
        : [...f.memberIds, uid],
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim())        return setError("Project Name is required.");
    if (!form.description.trim()) return setError("Description is required.");
    if (!form.deliveryFormat)     return setError("Please select a Delivery Format.");
    if (!form.ownerId)            return setError("Please assign a Project Owner.");
    if (!form.approverId)         return setError("Every project needs an Approver.");
    if (form.source === "Intake Request" && (!form.requestorName || !form.requestorDepartment)) {
      return setError("Please capture the Requestor name and department for intake requests.");
    }

    setSubmitting(true);
    try {
      const projectCode = await generateProjectCode();

      const projectRef = await addDoc(collection(db, "projects"), {
        projectCode,
        name:                form.name,
        ticketNumber:        form.ticketNumber.trim() || null,
        description:         form.description,
        source:              form.source,
        requestorName:       form.source === "Intake Request" ? form.requestorName       : null,
        requestorDepartment: form.source === "Intake Request" ? form.requestorDepartment : null,
        priority:            form.priority,
        templateId:          form.templateId,
        workTypeName: isLeap
          ? `LEAP — ${["Learn", ...Object.entries(leapPhases).filter(([n, on]) => on && n !== "Learn").map(([n]) => n)].join(" + ")}`
          : selectedTemplate.name,
        trainingType:        form.trainingType   || null,
        developmentType:     form.developmentType,
        deliveryFormat:      form.deliveryFormat || null,
        startDate:           form.startDate,
        targetLaunchDate:    form.targetLaunchDate || null,
        deadlineFlexibility: form.deadlineFlexibility,
        deadlineDriver:      form.deadlineDriver || null,

        // Planning status — separate from execution status
        planningStatus:      "Draft / Intake",
        status:              "Not Started",
        phase:               "Scoping",

        // Deadline fields
        baselineEndDate:               null,
        baselineStatus:                "Not Submitted",
        baselineRejectionComment:      null,
        approvedRevisedEndDate:        null,
        revisedDeadlineStatus:         null,
        proposedRevisedEndDate:        null,
        revisedDeadlineRejectionComment: null,
        actualCompletionDate:          null,

        ownerId:    form.ownerId,
        approverId: form.approverId,
        memberIds:  Array.from(new Set([...form.memberIds, form.ownerId, form.approverId])),
        folderUrl:  form.folderUrl  || null,
        smeName:    form.smeName    || null,
        createdBy:  user.uid,
        createdAt:  serverTimestamp(),
      });

      // Generate WBS tasks from selected template
      if (effectivePhases.length > 0) {
        const batch = writeBatch(db);
        let order = 0;
        effectivePhases.forEach((phase) => {
          phase.tasks.forEach((task) => {
            order += 1;
            const taskRef = doc(collection(db, "projects", projectRef.id, "tasks"));
            batch.set(taskRef, {
              parentTaskId:        null,
              phase:               phase.phase,
              name:                task.name,
              notes:               task.notes,
              responsibleRole:     task.role,
              assigneeId:          null,
              estimatedHours:      null,   // To be filled in WBS review
              actualHours:         null,
              startDate:           null,
              startDateOverridden: false,
              dueDate:             null,
              actualCompletionDate: null,
              status:              "Not Started",
              blockedBy:           [],
              order,
            });
          });
        });
        await batch.commit();
      }

      // Navigate to project detail with fromIntake flag so next-step banner shows
      navigate(`/projects/${projectRef.id}`, { state: { fromIntake: true } });

    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div>
      <h2 className="text-xl font-bold font-heading text-navy mb-0.5">New Project Intake</h2>
      <p className="text-xs text-gray-500 mb-5">
        Create a draft project and select the work type to generate the WBS. Resource planning will happen after WBS hours and required roles are confirmed.{" "}
        <span className="text-red-400">* Required</span>
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ══════════════════════════════════════════════════════════════════
            Section 1 — Project Request Details
        ══════════════════════════════════════════════════════════════════ */}
        <FieldGroup>
          <SectionHeader number="1" title="Project Request Details" />

          {/* Name + Priority */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Project Name<Req /></label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. New Hire Onboarding Program 2026"
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
                required
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Priority<Req /></label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              >
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>

          {/* Ticket # + Folder URL */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Ticket # <span className="text-gray-400">(optional)</span></label>
              <input
                placeholder="e.g. REQ-2026-045"
                value={form.ticketNumber}
                onChange={(e) => setForm({ ...form, ticketNumber: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Project Folder URL <span className="text-gray-400">(optional)</span></label>
              <input
                type="url"
                placeholder="https://..."
                value={form.folderUrl}
                onChange={(e) => setForm({ ...form, folderUrl: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              />
            </div>
          </div>

          {/* SME + Description */}
          <div className="mb-3">
            <label className="text-[11px] text-gray-500 mb-1 block">SME Name <span className="text-gray-400">(optional)</span></label>
            <input
              placeholder="Subject Matter Expert"
              value={form.smeName}
              onChange={(e) => setForm({ ...form, smeName: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>

          <div className="mb-3">
            <label className="text-[11px] text-gray-500 mb-1 block">Description<Req /></label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={3}
              placeholder="Briefly describe the project scope, learning need, and expected outcome."
              required
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>

          {/* Source */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Project Source<Req /></label>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              >
                {PROJECT_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          {/* Requestor fields — shown only for Intake Requests */}
          {form.source === "Intake Request" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 bg-slate-50 border border-gray-200 rounded-md p-3">
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">Requestor Name<Req /></label>
                <input
                  value={form.requestorName}
                  onChange={(e) => setForm({ ...form, requestorName: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
                  required
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">Requestor Department<Req /></label>
                <select
                  value={form.requestorDepartment}
                  onChange={(e) => setForm({ ...form, requestorDepartment: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
                  required
                >
                  <option value="">Select department…</option>
                  {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
            </div>
          )}
        </FieldGroup>

        {/* ══════════════════════════════════════════════════════════════════
            Section 2 — Planning Inputs
        ══════════════════════════════════════════════════════════════════ */}
        <FieldGroup>
          <SectionHeader
            number="2"
            title="Planning Inputs"
            subtitle="Dates and deadline context help L&D assess feasibility before WBS hours are confirmed."
          />

          {/* Start Date + Target Launch Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Start Date<Req /></label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
                required
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Target Launch Date <span className="text-gray-400">(desired go-live)</span></label>
              <input
                type="date"
                value={form.targetLaunchDate}
                onChange={(e) => setForm({ ...form, targetLaunchDate: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              />
            </div>
          </div>

          {/* Deadline Flexibility */}
          <div className="mb-3">
            <label className="text-[11px] text-gray-500 mb-1 block">Deadline Flexibility</label>
            <div className="grid grid-cols-3 gap-2">
              {DEADLINE_FLEXIBILITY_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => setForm({ ...form, deadlineFlexibility: opt.value })}
                  className={`text-left border rounded-md p-2.5 text-[11px] transition ${
                    form.deadlineFlexibility === opt.value
                      ? "border-navy bg-navy/5 text-navy ring-1 ring-navy/30"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  <div className="font-semibold mb-0.5">{opt.label}</div>
                  <div className="leading-snug text-gray-400">{opt.desc}</div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Indicate whether the requested launch date can move if resource capacity is insufficient.
            </p>
          </div>

          {/* Deadline Driver */}
          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">Deadline Driver <span className="text-gray-400">(optional)</span></label>
            <select
              value={form.deadlineDriver}
              onChange={(e) => setForm({ ...form, deadlineDriver: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
            >
              <option value="">Select deadline driver…</option>
              {DEADLINE_DRIVER_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Reason behind the requested launch date. Helps L&D prioritize when capacity is constrained.
            </p>
          </div>
        </FieldGroup>

        {/* ══════════════════════════════════════════════════════════════════
            Section 3 — Work Classification
        ══════════════════════════════════════════════════════════════════ */}
        <FieldGroup>
          <SectionHeader
            number="3"
            title="Work Classification"
            subtitle="Select the L&D Work Type to auto-generate the WBS task list for this project."
          />

          {/* L&D Work Type */}
          <div className="mb-3">
            <label className="text-[11px] text-gray-500 mb-1 block">L&D Work Type<Req /></label>
            <select
              value={form.templateId}
              onChange={(e) => setForm({ ...form, templateId: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
            >
              {WBS_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">{selectedTemplate.description}</p>
            {isLeap && (
              <div className="flex gap-4 mt-2 bg-slate-50 border border-gray-200 rounded-md p-2.5">
                <span className="text-[11px] text-gray-400 font-medium self-center">LEAP Phases:</span>
                {["Learn", "Engage", "Apply", "Prove"].map((phaseName) => (
                  <label key={phaseName} className="flex items-center gap-1.5 text-[12px]">
                    <input
                      type="checkbox"
                      checked={leapPhases[phaseName]}
                      onChange={(e) => setLeapPhases({ ...leapPhases, [phaseName]: e.target.checked })}
                    />
                    {phaseName}
                  </label>
                ))}
              </div>
            )}
            {totalTasks > 0 && (
              <p className="text-[11px] text-teal-700 mt-1.5 font-medium">
                ✓ {totalTasks} tasks across {effectivePhases.length} phases will be generated as draft WBS.
              </p>
            )}
          </div>

          {/* Training Type + Delivery Format */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Training Type <span className="text-gray-400">(optional)</span></label>
              <select
                value={form.trainingType}
                onChange={(e) => setForm({ ...form, trainingType: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              >
                <option value="">Select training type</option>
                {trainingTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">
                Manage in <Link to="/settings" className="text-teal-700 underline">Admin Settings</Link>
              </p>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Delivery Format<Req /></label>
              <select
                value={form.deliveryFormat}
                onChange={(e) => { setDeliveryTouched(true); setForm({ ...form, deliveryFormat: e.target.value }); }}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
                required
              >
                <option value="">Select delivery format</option>
                {deliveryFormats.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
              <p className="text-[10px] text-gray-400 mt-1">
                Manage in <Link to="/settings" className="text-teal-700 underline">Admin Settings</Link>
              </p>
            </div>
          </div>

          {/* Development Type / Effort Level */}
          <div>
            <label className="text-[11px] text-gray-500 mb-1.5 block">Development Type / Effort Level<Req /></label>
            <div className="grid grid-cols-3 gap-2">
              {DEVELOPMENT_TYPES.map((d) => (
                <button
                  type="button"
                  key={d.value}
                  onClick={() => setForm({ ...form, developmentType: d.value })}
                  className={`text-left border rounded-md p-2.5 text-[11px] transition ${
                    form.developmentType === d.value && d.value === "Level 1"
                      ? "border-green-400 bg-green-50 text-green-800 ring-1 ring-green-300"
                      : form.developmentType === d.value && d.value === "Level 2"
                      ? "border-amber-400 bg-amber-50 text-amber-800 ring-1 ring-amber-300"
                      : form.developmentType === d.value && d.value === "Level 3"
                      ? "border-red-400 bg-red-50 text-red-800 ring-1 ring-red-300"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  <div className="font-semibold mb-0.5">{d.label}</div>
                  <div className="leading-snug text-gray-400">{d.description}</div>
                </button>
              ))}
            </div>
          </div>
        </FieldGroup>

        {/* ══════════════════════════════════════════════════════════════════
            Section 4 — Ownership & Governance
        ══════════════════════════════════════════════════════════════════ */}
        <FieldGroup>
          <SectionHeader
            number="4"
            title="Ownership & Governance"
            subtitle="Assign the project owner and approver. Tentative contributors can be added now or after the WBS is confirmed."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            {/* Project Owner */}
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Project Owner<Req /></label>
              <select
                value={form.ownerId}
                onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
                required
              >
                <option value="" disabled>Select Project Owner</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ""}</option>
                ))}
              </select>
            </div>
            {/* Project Approver */}
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Project Approver<Req /></label>
              <select
                value={form.approverId}
                onChange={(e) => setForm({ ...form, approverId: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
                required
              >
                <option value="" disabled>Select Approver</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ""}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                Signs off on the baseline deadline and deadline change requests.
              </p>
            </div>
          </div>

          {/* Tentative Contributors */}
          <div>
            <label className="text-[11px] text-gray-500 mb-0.5 block">Tentative Contributors <span className="text-gray-400">(optional)</span></label>
            <p className="text-[11px] text-gray-400 mb-2">
              Optional. Final resource assignment will be confirmed after WBS effort and required roles are reviewed.
            </p>

            {/* Chips: Owner + Approver auto-included */}
            <div className="flex flex-wrap gap-1.5 mb-2.5">
              {form.ownerId && (
                <span className="inline-flex items-center gap-1 bg-navy/10 text-navy text-[11px] rounded-full px-2.5 py-1">
                  {users.find((u) => u.id === form.ownerId)?.name || "Owner"}
                  <span className="text-navy/40 text-[9px]">Owner</span>
                </span>
              )}
              {form.approverId && form.approverId !== form.ownerId && (
                <span className="inline-flex items-center gap-1 bg-navy/10 text-navy text-[11px] rounded-full px-2.5 py-1">
                  {users.find((u) => u.id === form.approverId)?.name || "Approver"}
                  <span className="text-navy/40 text-[9px]">Approver</span>
                </span>
              )}
              {form.memberIds.map((uid) => {
                const u = users.find((x) => x.id === uid);
                return u ? (
                  <span key={uid} className="inline-flex items-center gap-1 bg-teal-50 border border-teal-200 text-teal-800 text-[11px] rounded-full px-2.5 py-1">
                    {u.name}
                    <button type="button" onClick={() => toggleMember(uid)} className="text-teal-400 hover:text-red-400 ml-0.5 leading-none">✕</button>
                  </span>
                ) : null;
              })}
            </div>

            {/* Contributor picker */}
            {(() => {
              const available = users.filter(
                (u) => u.role !== "Exec Viewer" &&
                  u.id !== form.ownerId &&
                  u.id !== form.approverId &&
                  !form.memberIds.includes(u.id)
              );
              if (available.length === 0) return (
                <p className="text-[11px] text-gray-400 italic">All team members already added.</p>
              );
              return (
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) toggleMember(e.target.value); }}
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[12px] text-gray-500 focus:outline-none focus:ring-2 focus:ring-teal"
                >
                  <option value="">+ Add a tentative contributor…</option>
                  {available.map((u) => (
                    <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ""}</option>
                  ))}
                </select>
              );
            })()}
          </div>
        </FieldGroup>

        {/* ══════════════════════════════════════════════════════════════════
            Section 5 — Action
        ══════════════════════════════════════════════════════════════════ */}
        <div className="bg-slate-50 border border-gray-200 rounded-lg p-4">
          <div className="flex items-start gap-3 mb-3">
            <div className="flex-1">
              <div className="text-[12px] font-semibold text-navy mb-0.5">Ready to create the draft?</div>
              <div className="text-[11px] text-gray-500">
                This will create the project in <span className="font-medium text-navy">Draft / Intake</span> status and generate the WBS task list from the selected work type.
                Resource planning begins after you confirm task hours and required roles.
              </div>
            </div>
            <div className="shrink-0 text-right text-[10px] text-gray-400">
              <div>{totalTasks} tasks</div>
              <div>{effectivePhases.length} phases</div>
            </div>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md px-3 py-2 text-[12px] text-red-600 mb-3">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-navy text-white rounded-md py-2.5 text-[13px] font-semibold hover:bg-navy-light transition disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <span className="animate-spin text-[10px]">⟳</span>
                Creating draft &amp; generating WBS…
              </>
            ) : (
              "Create Draft & Generate WBS"
            )}
          </button>

          <p className="text-[10px] text-gray-400 text-center mt-2">
            Next step after creation: confirm WBS hours and assign required roles before resource planning.
          </p>
        </div>

      </form>
    </div>
  );
}
