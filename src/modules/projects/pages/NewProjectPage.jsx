import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  collection, onSnapshot, addDoc, writeBatch, doc, serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { WBS_TEMPLATES, LEAP_ANALYSIS, LEAP_PHASE_LIBRARY } from "../../../data/wbsTemplates";
import { PRIORITIES, PROJECT_SOURCES, DEVELOPMENT_TYPES, WORK_TYPE_DELIVERY_DEFAULTS } from "../../../data/staticOptions";
import { useSettingsList } from "../../../lib/useSettingsList";
import { generateProjectCode } from "../../../lib/projectCode";

const DEFAULT_TRAINING_TYPES  = ["Onboarding","Compliance & Safety","Technical & Systems","Leadership","Professional Development","Operational Support","L&D Improvements"];
const DEFAULT_DELIVERY_FORMATS = ["Face-to-Face ILT","Virtual ILT","Blended","E-Learning"];
const DEADLINE_FLEXIBILITY_OPTIONS = ["Fixed","Flexible","Negotiable"];
const DEADLINE_DRIVER_OPTIONS = ["Compliance","Leadership Request","Product Launch","Operational Need","Campaign","Other"];

function Req() { return <span className="text-red-400 ml-0.5">*</span>; }

// ── Section header matching mockup style ──────────────────────────────────────
const SECTION_ICONS = {
  1: <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />,
  2: <><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>,
  3: <path d="M4 6h16M4 12h16M4 18h7" />,
  4: <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></>,
};

const SECTION_COLORS = {
  1: "bg-blue-500",
  2: "bg-blue-500",
  3: "bg-blue-500",
  4: "bg-blue-500",
};

function SectionHeader({ number, title }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className={`w-8 h-8 rounded-full ${SECTION_COLORS[number]} flex items-center justify-center shrink-0`}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {SECTION_ICONS[number]}
        </svg>
      </div>
      <h3 className="text-[15px] font-bold text-blue-600">{number}. {title}</h3>
    </div>
  );
}

function Label({ children, optional }) {
  return (
    <label className="block text-[12px] font-medium text-gray-700 mb-1.5">
      {children}
      {optional && <span className="text-gray-400 font-normal ml-1">(optional)</span>}
    </label>
  );
}

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2.5 text-[13px] text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent placeholder-gray-400 bg-white";
const selectCls = "w-full border border-gray-300 rounded-lg px-3 py-2.5 text-[13px] text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent bg-white";

// ── Main page ─────────────────────────────────────────────────────────────────
export default function NewProjectPage() {
  const { user } = useAuth();
  const navigate  = useNavigate();

  const [users,           setUsers]           = useState([]);
  const [trainingTypes]                       = useSettingsList("trainingTypes",   DEFAULT_TRAINING_TYPES);
  const [deliveryFormats]                     = useSettingsList("deliveryFormats", DEFAULT_DELIVERY_FORMATS);
  const [departments]                         = useSettingsList("departments", [
    "Finance","Human Resources","Information Technology","Learning & Development",
    "Marketing","Operations","Production","Quality Assurance","Sales","Supply Chain","Warehouse",
  ]);

  const [form, setForm] = useState({
    name: "", ticketNumber: "", description: "", source: "", requestorName: "", requestorDepartment: "",
    priority: "Medium", templateId: WBS_TEMPLATES[0].id, trainingType: "", developmentType: DEVELOPMENT_TYPES[0].value,
    deliveryFormat: "", startDate: "", targetLaunchDate: "", deadlineFlexibility: "Flexible",
    deadlineDriver: "", ownerId: "", approverId: "", memberIds: [], folderUrl: "", smeName: "",
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
  const isLeap = selectedTemplate?.isLeap;
  const effectivePhases = isLeap
    ? [LEAP_ANALYSIS, ...Object.entries(leapPhases).filter(([, on]) => on).map(([name]) => LEAP_PHASE_LIBRARY[name])]
    : (selectedTemplate?.phases || []);
  const totalTasks = effectivePhases.reduce((n, p) => n + p.tasks.length, 0);

  useEffect(() => {
    if (deliveryTouched) return;
    const suggested = WORK_TYPE_DELIVERY_DEFAULTS[form.templateId];
    if (suggested) setForm((f) => ({ ...f, deliveryFormat: suggested }));
  }, [form.templateId, deliveryTouched]);

  const toggleMember = (uid) => {
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(uid) ? f.memberIds.filter((id) => id !== uid) : [...f.memberIds, uid],
    }));
  };

  const f = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim())        return setError("Project Name is required.");
    if (!form.description.trim()) return setError("Description is required.");
    if (!form.deliveryFormat)     return setError("Please select a Delivery Format.");
    if (!form.ownerId)            return setError("Please assign a Project Owner.");
    if (!form.approverId)         return setError("Every project needs an Approver.");
    setSubmitting(true);
    try {
      const projectCode = await generateProjectCode();
      const projectRef = await addDoc(collection(db, "projects"), {
        projectCode, name: form.name,
        ticketNumber:        form.ticketNumber.trim() || null,
        description:         form.description,
        source:              form.source || null,
        requestorName:       form.requestorName || null,
        requestorDepartment: form.requestorDepartment || null,
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
        planningStatus:      "Draft / Intake",
        status:              "Not Started",
        phase:               "Scoping",
        baselineEndDate:     null, baselineStatus: "Not Submitted", baselineRejectionComment: null,
        approvedRevisedEndDate: null, revisedDeadlineStatus: null, proposedRevisedEndDate: null,
        revisedDeadlineRejectionComment: null, actualCompletionDate: null,
        ownerId:    form.ownerId,
        approverId: form.approverId,
        memberIds:  Array.from(new Set([...form.memberIds, form.ownerId, form.approverId])),
        folderUrl:  form.folderUrl  || null,
        smeName:    form.smeName    || null,
        createdBy:  user.uid,
        createdAt:  serverTimestamp(),
      });

      if (effectivePhases.length > 0) {
        const batch = writeBatch(db);
        let order = 0;
        effectivePhases.forEach((phase) => {
          phase.tasks.forEach((task) => {
            order += 1;
            const taskRef = doc(collection(db, "projects", projectRef.id, "tasks"));
            batch.set(taskRef, {
              parentTaskId: null, phase: phase.phase, name: task.name, notes: task.notes,
              responsibleRole: task.role, assigneeId: null, estimatedHours: null, actualHours: null,
              startDate: null, startDateOverridden: false, dueDate: null, actualCompletionDate: null,
              status: "Not Started", blockedBy: [], order,
            });
          });
        });
        await batch.commit();
      }
      navigate(`/projects/${projectRef.id}`, { state: { fromIntake: true } });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const availableContributors = users.filter(
    (u) => u.role !== "Exec Viewer" && u.id !== form.ownerId && u.id !== form.approverId && !form.memberIds.includes(u.id)
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Page header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-2xl font-bold font-heading text-navy">New Project Setup</h2>
            <p className="text-[13px] text-gray-500 mt-1">
              Create a draft project and select the work type to generate the WBS. Resource planning will happen after WBS hours and required roles are confirmed.
              <span className="text-red-400 ml-2">* Required</span>
            </p>
          </div>
          <button
            type="button"
            className="flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 py-2 text-[12px] text-gray-500 hover:bg-gray-50 transition"
            title="Help"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3M12 17h.01"/></svg>
            Help
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-3 gap-5">
            {/* ── Left: main sections ── */}
            <div className="col-span-2 space-y-5">

              {/* ── Section 1: Project Request Details ── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <SectionHeader number={1} title="Project Request Details" />

                {/* Row 1: Name | Ticket | Folder */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <Label>Project Name <Req /></Label>
                    <input className={inputCls} placeholder="e.g. Leadership Essentials eLearning"
                      value={form.name} onChange={(e) => f("name", e.target.value)} required />
                  </div>
                  <div>
                    <Label optional>Ticket #</Label>
                    <input className={inputCls} placeholder="e.g. REQ-2026-045"
                      value={form.ticketNumber} onChange={(e) => f("ticketNumber", e.target.value)} />
                  </div>
                  <div>
                    <Label optional>Project Folder URL</Label>
                    <input type="url" className={inputCls} placeholder="https://..."
                      value={form.folderUrl} onChange={(e) => f("folderUrl", e.target.value)} />
                  </div>
                </div>

                {/* Row 2: Description — full width */}
                <div className="mb-4">
                  <Label>Description <Req /></Label>
                  <textarea className={inputCls} rows={3} required
                    placeholder="Brief description of the project, objectives, and key deliverables..."
                    value={form.description} onChange={(e) => f("description", e.target.value)} />
                </div>

                {/* Row 3: Source | Requestor Name | Requestor Dept */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <Label>Project Source <Req /></Label>
                    <select className={selectCls} value={form.source} onChange={(e) => f("source", e.target.value)}>
                      <option value="">Select project source</option>
                      {PROJECT_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Requestor Name <Req /></Label>
                    <input className={inputCls} placeholder="e.g. Maria Santos"
                      value={form.requestorName} onChange={(e) => f("requestorName", e.target.value)} />
                  </div>
                  <div>
                    <Label>Requestor Department <Req /></Label>
                    <select className={selectCls} value={form.requestorDepartment} onChange={(e) => f("requestorDepartment", e.target.value)}>
                      <option value="">Select department</option>
                      {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              {/* ── Section 2: Planning Inputs ── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <SectionHeader number={2} title="Planning Inputs" />

                {/* Row 1: Priority | Start Date | Target Launch Date */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div>
                    <Label>Priority <Req /></Label>
                    <select className={selectCls} value={form.priority} onChange={(e) => f("priority", e.target.value)}>
                      {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Start Date <Req /></Label>
                    <input type="date" className={inputCls}
                      value={form.startDate} onChange={(e) => f("startDate", e.target.value)} required />
                  </div>
                  <div>
                    <Label>Target Launch Date <Req /></Label>
                    <input type="date" className={inputCls}
                      value={form.targetLaunchDate} onChange={(e) => f("targetLaunchDate", e.target.value)} />
                  </div>
                </div>

                {/* Row 2: Deadline Flexibility | Deadline Driver */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Label>Deadline Flexibility <Req /></Label>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                    </div>
                    <select className={selectCls} value={form.deadlineFlexibility} onChange={(e) => f("deadlineFlexibility", e.target.value)}>
                      <option value="">Select flexibility</option>
                      {DEADLINE_FLEXIBILITY_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1.5">Indicate whether the requested launch date can move if resource capacity is insufficient.</p>
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <label className="text-[12px] font-medium text-gray-700 text-teal-600">Deadline Driver <Req /></label>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                    </div>
                    <select className={selectCls} value={form.deadlineDriver} onChange={(e) => f("deadlineDriver", e.target.value)}>
                      <option value="">Select driver</option>
                      {DEADLINE_DRIVER_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1.5">Reason behind the requested launch date.</p>
                  </div>
                </div>
              </div>

              {/* ── Section 3: Work Classification ── */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <SectionHeader number={3} title="Work Classification" />

                {/* Row 1: Work Type | Training Type | Delivery Format */}
                <div className="grid grid-cols-3 gap-4 mb-5">
                  <div>
                    <Label>L&D Work Type <Req /></Label>
                    <select className={selectCls} value={form.templateId}
                      onChange={(e) => { f("templateId", e.target.value); }}>
                      {WBS_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1.5">Select the type of L&D work to apply the correct workflow and WBS template.</p>
                    {isLeap && (
                      <div className="flex flex-wrap gap-2 mt-2">
                        {["Learn","Engage","Apply","Prove"].map((ph) => (
                          <label key={ph} className="flex items-center gap-1 text-[11px] text-gray-600">
                            <input type="checkbox" checked={leapPhases[ph]}
                              onChange={(e) => setLeapPhases({ ...leapPhases, [ph]: e.target.checked })} />
                            {ph}
                          </label>
                        ))}
                      </div>
                    )}
                    {totalTasks > 0 && (
                      <p className="text-[11px] text-teal-600 font-medium mt-1.5">✓ {totalTasks} tasks across {effectivePhases.length} phases</p>
                    )}
                  </div>
                  <div>
                    <Label optional>Training Type</Label>
                    <select className={selectCls} value={form.trainingType} onChange={(e) => f("trainingType", e.target.value)}>
                      <option value="">Select training type</option>
                      {trainingTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1.5">Manage options in <Link to="/settings" className="text-blue-500 hover:underline">Admin Settings</Link></p>
                  </div>
                  <div>
                    <Label>Delivery Format <Req /></Label>
                    <select className={selectCls} value={form.deliveryFormat}
                      onChange={(e) => { setDeliveryTouched(true); f("deliveryFormat", e.target.value); }} required>
                      <option value="">Select delivery format</option>
                      {deliveryFormats.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1.5">Manage options in <Link to="/settings" className="text-blue-500 hover:underline">Admin Settings</Link></p>
                  </div>
                </div>

                {/* Development Type / Effort Level — radio style */}
                <div>
                  <Label>Development Type / Effort Level <Req /></Label>
                  <div className="grid grid-cols-3 gap-3 mt-1">
                    {DEVELOPMENT_TYPES.map((d) => {
                      const isSelected = form.developmentType === d.value;
                      const colors = {
                        "Level 1": { border: "border-green-400",  ring: "ring-green-200",  dot: "bg-green-500",  bg: "bg-green-50"  },
                        "Level 2": { border: "border-amber-400",  ring: "ring-amber-200",  dot: "bg-amber-500",  bg: "bg-amber-50"  },
                        "Level 3": { border: "border-red-400",    ring: "ring-red-200",    dot: "bg-red-500",    bg: "bg-red-50"    },
                      };
                      const c = colors[d.value] || { border: "border-gray-300", ring: "ring-gray-200", dot: "bg-gray-400", bg: "bg-white" };
                      return (
                        <button type="button" key={d.value}
                          onClick={() => f("developmentType", d.value)}
                          className={`text-left p-4 rounded-xl border-2 transition ${isSelected ? `${c.border} ${c.bg} ring-2 ${c.ring}` : "border-gray-200 bg-white hover:border-gray-300"}`}
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isSelected ? c.border : "border-gray-300"}`}>
                              {isSelected && <div className={`w-2 h-2 rounded-full ${c.dot}`} />}
                            </div>
                            <span className="text-[13px] font-semibold text-gray-800">{d.label}</span>
                          </div>
                          <p className="text-[11px] text-gray-500 leading-snug">{d.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* ── Right sidebar ── */}
            <div className="col-span-1 space-y-4 sticky top-6 self-start">

              {/* Ownership & Governance */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-7 h-7 rounded-full bg-blue-500 flex items-center justify-center shrink-0">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
                    </svg>
                  </div>
                  <h3 className="text-[14px] font-bold text-blue-600">4. Ownership &amp; Governance</h3>
                </div>

                <div className="space-y-3">
                  <div>
                    <Label>Project Owner <Req /></Label>
                    <select className={selectCls} value={form.ownerId}
                      onChange={(e) => f("ownerId", e.target.value)} required>
                      <option value="">Select project owner</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ""}</option>)}
                    </select>
                  </div>
                  <div>
                    <Label>Project Approver <Req /></Label>
                    <select className={selectCls} value={form.approverId}
                      onChange={(e) => f("approverId", e.target.value)} required>
                      <option value="">Select approver</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ""}</option>)}
                    </select>
                    <p className="text-[11px] text-gray-400 mt-1">Approver signs off on the baseline deadline and deadline change requests.</p>
                  </div>
                  <div>
                    <Label optional>SME Name</Label>
                    <input className={inputCls} placeholder="Subject Matter Expert name..."
                      value={form.smeName} onChange={(e) => f("smeName", e.target.value)} />
                  </div>
                </div>
              </div>

              {/* Tentative Contributors */}
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
                <div className="flex items-center gap-1.5 mb-1">
                  <h3 className="text-[13px] font-semibold text-gray-800">Tentative Contributors</h3>
                  <span className="text-[11px] text-gray-400">(optional)</span>
                </div>
                <p className="text-[11px] text-gray-400 mb-3">Optional. Final resource assignment will be confirmed after WBS effort and required roles are reviewed.</p>

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
                {availableContributors.length > 0 && (
                  <select value="" onChange={(e) => { if (e.target.value) toggleMember(e.target.value); }}
                    className={selectCls}>
                    <option value="">+ Add a contributor</option>
                    {availableContributors.map((u) => (
                      <option key={u.id} value={u.id}>{u.name}{u.jobTitle ? ` — ${u.jobTitle}` : ""}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* What happens next */}
              <div className="bg-blue-50 rounded-xl border border-blue-100 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
                  <h3 className="text-[13px] font-semibold text-blue-700">What happens next?</h3>
                </div>
                <ul className="space-y-2">
                  {[
                    "A project will be created as a Draft / Intake.",
                    "The WBS will be generated from the selected work type and development level.",
                    "You will review the WBS, confirm hours and required roles, and then proceed to resource planning.",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2.5" className="shrink-0 mt-0.5"><path d="M20 6L9 17l-5-5"/></svg>
                      <span className="text-[12px] text-blue-700 leading-snug">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Error */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-[12px] text-red-600">
                  {error}
                </div>
              )}

              {/* CTA */}
              <button type="submit" disabled={submitting}
                className="w-full bg-navy text-white rounded-xl py-3.5 text-[14px] font-semibold hover:bg-navy-light transition disabled:opacity-50 flex items-center justify-center gap-2.5">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3 3 3-3"/></svg>
                {submitting ? "Creating draft & generating WBS…" : "Create Draft & Generate WBS"}
              </button>

              <button type="button" onClick={() => navigate("/projects")}
                className="w-full border border-gray-300 bg-white text-gray-700 rounded-xl py-3 text-[13px] font-medium hover:bg-gray-50 transition">
                Cancel
              </button>

              <p className="text-[10px] text-gray-400 text-center flex items-center justify-center gap-1">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
                Your changes are saved automatically as you complete this form.
              </p>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
