import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  "Onboarding",
  "Compliance & Safety",
  "Technical & Systems",
  "Leadership",
  "Professional Development",
  "Operational Support",
  "L&D Improvements",
];

const DEFAULT_DELIVERY_FORMATS = ["Face-to-Face ILT", "Virtual ILT", "Blended", "E-Learning"];

export default function NewProjectPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [trainingTypes, addTrainingType] = useSettingsList("trainingTypes", DEFAULT_TRAINING_TYPES);
  const [deliveryFormats, addDeliveryFormat] = useSettingsList(
    "deliveryFormats",
    DEFAULT_DELIVERY_FORMATS
  );
  const [newTrainingType, setNewTrainingType] = useState("");
  const [newDeliveryFormat, setNewDeliveryFormat] = useState("");

  const [form, setForm] = useState({
    name: "",
    description: "",
    source: PROJECT_SOURCES[0],
    requestorName: "",
    requestorDepartment: "",
    priority: "Medium",
    templateId: WBS_TEMPLATES[0].id,
    trainingType: "",
    developmentType: DEVELOPMENT_TYPES[0].value,
    deliveryFormat: "",
    startDate: "",
    ownerId: "",
    approverId: "",
    memberIds: [],
    folderUrl: "",
  });
  const [leapPhases, setLeapPhases] = useState({ Learn: true, Engage: false, Apply: false, Prove: false });
  const [deliveryTouched, setDeliveryTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

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

  // Smart-fill Delivery Format from Work Type, but only if the user hasn't
  // manually touched that field yet.
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
    if (!form.ownerId) return setError("Please assign a Project Owner.");
    if (!form.approverId) return setError("Every project needs an Approver.");
    if (form.source === "Intake Request" && (!form.requestorName || !form.requestorDepartment)) {
      return setError("Please capture the Requestor name and department for intake requests.");
    }
    setSubmitting(true);
    try {
      const projectCode = await generateProjectCode();

      const projectRef = await addDoc(collection(db, "projects"), {
        projectCode,
        name: form.name,
        description: form.description,
        source: form.source,
        requestorName: form.source === "Intake Request" ? form.requestorName : null,
        requestorDepartment: form.source === "Intake Request" ? form.requestorDepartment : null,
        priority: form.priority,
        templateId: form.templateId,
        workTypeName: isLeap
          ? `LEAP \u2014 ${["Learn", ...Object.entries(leapPhases).filter(([n, on]) => on && n !== "Learn").map(([n]) => n)].join(" + ")}`
          : selectedTemplate.name,
        trainingType: form.trainingType || null,
        developmentType: form.developmentType,
        deliveryFormat: form.deliveryFormat || null,
        startDate: form.startDate,
        baselineEndDate: null,
        baselineStatus: "Not Submitted",
        baselineRejectionComment: null,
        approvedRevisedEndDate: null,
        revisedDeadlineStatus: null,
        proposedRevisedEndDate: null,
        revisedDeadlineRejectionComment: null,
        actualCompletionDate: null,
        ownerId: form.ownerId,
        approverId: form.approverId,
        memberIds: Array.from(new Set([...form.memberIds, form.ownerId, form.approverId])),
        folderUrl: form.folderUrl || null,
        status: "Not Started",
        createdBy: user.uid,
        createdAt: serverTimestamp(),
      });

      if (effectivePhases.length > 0) {
        const batch = writeBatch(db);
        let order = 0;
        effectivePhases.forEach((phase) => {
          phase.tasks.forEach((task) => {
            order += 1;
            const taskRef = doc(collection(db, "projects", projectRef.id, "tasks"));
            batch.set(taskRef, {
              parentTaskId: null,
              phase: phase.phase,
              name: task.name,
              notes: task.notes,
              responsibleRole: task.role,
              assigneeId: null,
              estimatedHours: null,
              actualHours: null,
              startDate: null,
              startDateOverridden: false,
              dueDate: null,
              actualCompletionDate: null,
              status: "Not Started",
              blockedBy: [],
              order,
            });
          });
        });
        await batch.commit();
      }

      navigate(`/projects/${projectRef.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2 className="text-xl font-bold font-heading text-navy mb-0.5">New Project</h2>
      <p className="text-xs text-gray-500 mb-4">
        Task dates aren't set here — pick a Work Type to auto-generate the task list, then head to
        the project page to assign owners and hours. Dates calculate from there.
      </p>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-lg shadow-sm border border-gray-100 p-3.5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Project Name</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
                required
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Priority</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Project Source</label>
              <select
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              >
                {PROJECT_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Start Date</label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
                required
              />
            </div>
          </div>

          {form.source === "Intake Request" && (
            <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded-md p-2.5">
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">Requestor Name</label>
                <input
                  value={form.requestorName}
                  onChange={(e) => setForm({ ...form, requestorName: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
                  required
                />
              </div>
              <div>
                <label className="text-[11px] text-gray-500 mb-1 block">Requestor Department</label>
                <input
                  value={form.requestorDepartment}
                  onChange={(e) => setForm({ ...form, requestorDepartment: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
                  required
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">L&D Work Type</label>
            <select
              value={form.templateId}
              onChange={(e) => setForm({ ...form, templateId: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
            >
              {WBS_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">{selectedTemplate.description}</p>
            {isLeap && (
              <div className="flex gap-3 mt-2 bg-slate-50 rounded-md p-2.5">
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
              <p className="text-[11px] text-teal-700 mt-1">
                {totalTasks} tasks across {effectivePhases.length} phases will be
                auto-generated. You can change Work Type later, but it won't regenerate the task
                list once tasks have progress.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Training Type</label>
              <select
                value={form.trainingType}
                onChange={(e) => setForm({ ...form, trainingType: e.target.value })}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              >
                <option value="">Select training type</option>
                {trainingTypes.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <div className="flex gap-2 mt-1.5">
                <input
                  placeholder="Add new..."
                  value={newTrainingType}
                  onChange={(e) => setNewTrainingType(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => {
                    addTrainingType(newTrainingType);
                    setForm((f) => ({ ...f, trainingType: newTrainingType.trim() }));
                    setNewTrainingType("");
                  }}
                  className="text-[11px] bg-slate-100 text-navy px-2 py-1 rounded-md hover:bg-slate-200"
                >
                  + Add
                </button>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-gray-500 mb-1 block">Delivery Format</label>
              <select
                value={form.deliveryFormat}
                onChange={(e) => {
                  setDeliveryTouched(true);
                  setForm({ ...form, deliveryFormat: e.target.value });
                }}
                className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              >
                <option value="">Select delivery format</option>
                {deliveryFormats.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <div className="flex gap-2 mt-1.5">
                <input
                  placeholder="Add new..."
                  value={newDeliveryFormat}
                  onChange={(e) => setNewDeliveryFormat(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-md px-2 py-1 text-[11px]"
                />
                <button
                  type="button"
                  onClick={() => {
                    addDeliveryFormat(newDeliveryFormat);
                    setDeliveryTouched(true);
                    setForm((f) => ({ ...f, deliveryFormat: newDeliveryFormat.trim() }));
                    setNewDeliveryFormat("");
                  }}
                  className="text-[11px] bg-slate-100 text-navy px-2 py-1 rounded-md hover:bg-slate-200"
                >
                  + Add
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">Development Type (Effort)</label>
            <div className="grid grid-cols-3 gap-2">
              {DEVELOPMENT_TYPES.map((d) => (
                <button
                  type="button"
                  key={d.value}
                  onClick={() => setForm({ ...form, developmentType: d.value })}
                  className={`text-left border rounded-md p-2 text-[11px] transition ${
                    form.developmentType === d.value
                      ? "border-teal bg-teal/10 text-teal-800"
                      : "border-gray-200 text-gray-500 hover:border-gray-300"
                  }`}
                >
                  <div className="font-semibold mb-0.5">{d.label}</div>
                  <div className="leading-snug">{d.description}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[11px] text-gray-500 mb-1 block">Project Folder URL (optional)</label>
            <input
              type="url"
              placeholder="https://..."
              value={form.folderUrl}
              onChange={(e) => setForm({ ...form, folderUrl: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
            />
          </div>
        </div>

        <div className="lg:col-span-1 space-y-3">
          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5">
            <label className="text-[11px] text-gray-500 mb-1 block">Project Owner</label>
            <select
              value={form.ownerId}
              onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              required
            >
              <option value="" disabled>
                Select Project Owner
              </option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.jobTitle ? `— ${u.jobTitle}` : ""}
                </option>
              ))}
            </select>

            <label className="text-[11px] text-gray-500 mb-1 block mt-3">
              Project Approver <span className="text-red-500">(required)</span>
            </label>
            <select
              value={form.approverId}
              onChange={(e) => setForm({ ...form, approverId: e.target.value })}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              required
            >
              <option value="" disabled>
                Select Approver
              </option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} {u.jobTitle ? `— ${u.jobTitle}` : ""}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-gray-400 mt-1">
              Approver signs off on the baseline deadline and deadline change requests. Doesn't
              have to be the Owner.
            </p>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5">
            <label className="text-[11px] text-gray-500 mb-2 block">Team Members (Contributors)</label>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {users.map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-[13px] py-0.5">
                  <input
                    type="checkbox"
                    checked={form.memberIds.includes(u.id)}
                    onChange={() => toggleMember(u.id)}
                  />
                  {u.name}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-2">
              Invite-only — only people checked here (plus Owner and Approver) can see this
              project.
            </p>
          </div>

          {error && <p className="text-[11px] text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-navy text-white rounded-md py-2 text-[13px] font-medium hover:bg-navy-light transition disabled:opacity-50"
          >
            {submitting ? "Creating..." : "Create Project"}
          </button>
        </div>
      </form>
    </div>
  );
}
