import { useState, useEffect, useMemo } from "react";
import { useParams, Link } from "react-router-dom";
import {
  doc,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  updateDoc,
  addDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDate(value) {
  if (!value) return "—";
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function addWorkDays(startValue, days) {
  if (!startValue || !days || days <= 0) return null;
  const d = startValue?.toDate ? startValue.toDate() : new Date(startValue);
  if (isNaN(d)) return null;
  let added = 0;
  const result = new Date(d);
  while (added < Math.round(days)) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return result;
}

function daysBetween(startValue, endValue) {
  if (!startValue || !endValue) return 0;
  const s = startValue?.toDate ? startValue.toDate() : new Date(startValue);
  const e = endValue?.toDate ? endValue.toDate() : new Date(endValue);
  if (isNaN(s) || isNaN(e)) return 0;
  return Math.max(0, Math.round((e - s) / (1000 * 60 * 60 * 24)));
}

function toDateObj(value) {
  if (!value) return null;
  const d = value?.toDate ? value.toDate() : new Date(value);
  return isNaN(d) ? null : d;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const map = {
    "Not Submitted": "bg-gray-100 text-gray-600",
    "Pending Approval": "bg-yellow-100 text-yellow-700",
    Approved: "bg-emerald-100 text-emerald-700",
    Rejected: "bg-red-100 text-red-700",
  };
  const cls = map[status] || "bg-gray-100 text-gray-500";
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>
      {status || "—"}
    </span>
  );
}

function PlanningStatusPill({ status }) {
  const map = {
    "Draft / Intake": "bg-gray-100 text-gray-600",
    "WBS Pending": "bg-blue-100 text-blue-700",
    "Resource Check": "bg-orange-100 text-orange-700",
    "Pending Approval": "bg-yellow-100 text-yellow-700",
    Active: "bg-emerald-100 text-emerald-700",
  };
  const cls = map[status] || "bg-gray-100 text-gray-500";
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-[11px] font-semibold ${cls}`}>
      {status || "—"}
    </span>
  );
}

function KeyValueRow({ label, value }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-gray-100 last:border-0 gap-4">
      <span className="text-[12px] text-gray-500 font-medium shrink-0 w-44">{label}</span>
      <span className="text-[13px] text-gray-800 font-medium text-right">{value ?? "—"}</span>
    </div>
  );
}

function TimelineBar({ label, color, days, maxDays, date }) {
  const pct = maxDays > 0 ? Math.min(100, Math.round((days / maxDays) * 100)) : 0;
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11px] text-gray-500 font-medium">{label}</span>
        <span className="text-[11px] text-gray-400">{date || "—"}</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-3">
        <div
          className="h-3 rounded-full transition-all duration-500"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function ActivityEntry({ entry }) {
  const typeStyles = {
    baseline_submitted: "bg-blue-400",
    baseline_approved: "bg-emerald-400",
    baseline_rejected: "bg-red-400",
  };
  const dotCls = typeStyles[entry.type] || "bg-gray-300";
  const ts = entry.createdAt?.toDate ? entry.createdAt.toDate() : null;
  return (
    <div className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
      <div className="mt-1.5 shrink-0">
        <span className={`inline-block w-2 h-2 rounded-full ${dotCls}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-gray-700 leading-snug">{entry.message}</p>
        {ts && (
          <p className="text-[11px] text-gray-400 mt-0.5">
            {ts.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{" "}
            {ts.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function ProjectBaselinePage() {
  const { id } = useParams();
  const { user, profile } = useAuth();

  // ── State ──────────────────────────────────────────────────────────────────
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [users, setUsers] = useState([]);
  const [activity, setActivity] = useState([]);

  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState("");

  // Approver flow state
  const [showRejectComment, setShowRejectComment] = useState(false);
  const [showRequestChangesComment, setShowRequestChangesComment] = useState(false);
  const [approvalComment, setApprovalComment] = useState("");
  const [rejectComment, setRejectComment] = useState("");
  const [requestChangesComment, setRequestChangesComment] = useState("");

  const [showHistory, setShowHistory] = useState(false);

  // ── Firestore subscriptions ────────────────────────────────────────────────
  useEffect(() => {
    if (!id) return;
    const unsub = onSnapshot(doc(db, "projects", id), (snap) => {
      setProject(snap.exists() ? { id: snap.id, ...snap.data() } : null);
    });
    return unsub;
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, "projects", id, "tasks"), orderBy("order"));
    const unsub = onSnapshot(q, (snap) => {
      setTasks(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [id]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "users"), (snap) => {
      setUsers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!id) return;
    const q = query(
      collection(db, "projects", id, "activity"),
      orderBy("createdAt", "desc"),
      limit(10)
    );
    const unsub = onSnapshot(q, (snap) => {
      setActivity(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [id]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const isApprover = project?.approverId === user?.uid;
  const isOwner = project?.ownerId === user?.uid;
  const isAdmin = profile?.role === "Admin";

  const userName = (uid) => {
    if (!uid) return "—";
    const u = users.find((x) => x.id === uid);
    return u?.displayName || u?.name || u?.email || uid;
  };

  const totalHours = useMemo(() => {
    if (!tasks) return 0;
    return tasks
      .filter((t) => !t.parentId)
      .reduce((sum, t) => sum + (Number(t.estimatedHours) || 0), 0);
  }, [tasks]);

  const effortDays = totalHours > 0 ? totalHours / 7.5 : 0;

  const effortEndDate = useMemo(() => {
    if (!project?.startDate || effortDays <= 0) return null;
    return addWorkDays(project.startDate, effortDays);
  }, [project?.startDate, effortDays]);

  const proposedBaselineDate = useMemo(() => {
    if (effortEndDate) return effortEndDate.toISOString().split("T")[0];
    if (!project?.targetLaunchDate) return null;
    const d = toDateObj(project.targetLaunchDate);
    return d ? d.toISOString().split("T")[0] : null;
  }, [effortEndDate, project?.targetLaunchDate]);

  const startDateObj = toDateObj(project?.startDate);
  const targetDateObj = toDateObj(project?.targetLaunchDate);
  const baselineDateObj = toDateObj(project?.baselineEndDate);

  const targetDays = daysBetween(startDateObj, targetDateObj);
  const effortDaysFromStart = daysBetween(startDateObj, effortEndDate);
  const baselineDaysFromStart = daysBetween(startDateObj, baselineDateObj);
  const proposedDays = effortEndDate ? effortDaysFromStart : targetDays;

  const maxBarDays = Math.max(targetDays, effortDaysFromStart, baselineDaysFromStart, 1);

  // ── Action handlers ────────────────────────────────────────────────────────
  async function submitBaseline() {
    if (submitting) return;
    setSubmitting(true);
    setActionError("");
    try {
      await updateDoc(doc(db, "projects", id), {
        baselineStatus: "Pending Approval",
        planningStatus: "Pending Approval",
      });
      await addDoc(collection(db, "projects", id, "activity"), {
        type: "baseline_submitted",
        message: `Baseline submitted for approval by ${user.displayName || user.email}`,
        uid: user.uid,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      setActionError("Failed to submit baseline. Please try again.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function approveBaseline() {
    if (submitting || !proposedBaselineDate) return;
    setSubmitting(true);
    setActionError("");
    try {
      await updateDoc(doc(db, "projects", id), {
        baselineStatus: "Approved",
        baselineEndDate: proposedBaselineDate,
        planningStatus: "Active",
        status: "Active",
        phase: "Planning",
      });
      await addDoc(collection(db, "projects", id, "activity"), {
        type: "baseline_approved",
        message: `Baseline approved. End date locked to ${proposedBaselineDate}.`,
        uid: user.uid,
        createdAt: serverTimestamp(),
      });
    } catch (err) {
      setActionError("Failed to approve baseline. Please try again.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function requestChanges() {
    const comment = requestChangesComment.trim();
    if (!comment) {
      setActionError("A comment is required to request changes.");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setActionError("");
    try {
      await updateDoc(doc(db, "projects", id), {
        baselineStatus: "Rejected",
        baselineRejectionComment: comment,
        planningStatus: "Resource Check",
      });
      await addDoc(collection(db, "projects", id, "activity"), {
        type: "baseline_rejected",
        message: `Changes requested: ${comment}`,
        uid: user.uid,
        createdAt: serverTimestamp(),
      });
      setShowRequestChangesComment(false);
      setRequestChangesComment("");
    } catch (err) {
      setActionError("Failed to request changes. Please try again.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  async function rejectProject() {
    const comment = rejectComment.trim();
    if (!comment) {
      setActionError("A comment is required to reject the project.");
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    setActionError("");
    try {
      await updateDoc(doc(db, "projects", id), {
        status: "Canceled",
        phase: "Canceled",
        baselineStatus: "Rejected",
        baselineRejectionComment: comment,
        planningStatus: "Draft / Intake",
      });
      await addDoc(collection(db, "projects", id, "activity"), {
        type: "baseline_rejected",
        message: `Project rejected: ${comment}`,
        uid: user.uid,
        createdAt: serverTimestamp(),
      });
      setShowRejectComment(false);
      setRejectComment("");
    } catch (err) {
      setActionError("Failed to reject project. Please try again.");
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading guard ──────────────────────────────────────────────────────────
  if (!project || tasks === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-teal-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-gray-500">Loading baseline data…</p>
        </div>
      </div>
    );
  }

  const { baselineStatus, baselineRejectionComment } = project;

  const showOwnerActions =
    isOwner &&
    (baselineStatus === "Not Submitted" || baselineStatus === "Rejected");
  const showApproverActions =
    (isApprover || isAdmin) && baselineStatus === "Pending Approval";
  const showLockedState = baselineStatus === "Approved";

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Page Header ─────────────────────────────────────────────────── */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-6xl mx-auto">
          <Link
            to={`/projects/${id}`}
            className="inline-flex items-center gap-1.5 text-[12px] text-gray-500 hover:text-gray-700 mb-3 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Project
          </Link>

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-[#0F2240]">Baseline & Approval</h1>
              <p className="text-[12px] text-gray-500 mt-1 max-w-xl">
                Review the project baseline before locking the schedule. Once approved, the baseline
                end date cannot be freely changed.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {project.name && (
                <span className="inline-flex items-center px-3 py-1 bg-[#0F2240]/5 text-[#0F2240] rounded-lg text-[12px] font-semibold border border-[#0F2240]/10">
                  {project.projectCode ? `[${project.projectCode}] ` : ""}
                  {project.name}
                </span>
              )}
              <PlanningStatusPill status={project.planningStatus} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Baseline Status Banner ───────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 pt-5">
        {baselineStatus === "Not Submitted" && (
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 mb-5">
            <svg className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            <p className="text-[13px] text-blue-800">
              Baseline not yet submitted. The project owner can submit for approval when ready.
            </p>
          </div>
        )}

        {baselineStatus === "Pending Approval" && (
          <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3 mb-5">
            <span className="text-base shrink-0">&#9203;</span>
            <p className="text-[13px] text-yellow-800">
              <span className="font-semibold">Awaiting approval.</span> The approver needs to review
              and approve the baseline.
            </p>
          </div>
        )}

        {baselineStatus === "Approved" && (
          <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 mb-5">
            <svg className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <p className="text-[13px] text-emerald-800">
              <span className="font-semibold">Baseline approved and locked.</span> End date:{" "}
              <span className="font-semibold">{formatDate(project.baselineEndDate)}</span>.
            </p>
          </div>
        )}

        {baselineStatus === "Rejected" && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3 mb-5">
            <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <p className="text-[13px] text-red-800">
              <span className="font-semibold">Changes requested:</span>{" "}
              {baselineRejectionComment || "No comment provided."}
            </p>
          </div>
        )}
      </div>

      {/* ── Two-column Body ──────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 pb-8">
        <div className="grid grid-cols-5 gap-5">
          {/* ─── Left col (3/5) ─────────────────────────────────────────── */}
          <div className="col-span-3 space-y-5">
            {/* Baseline Summary card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-[13px] font-bold text-[#0F2240] mb-3 uppercase tracking-wide">
                Baseline Summary
              </h2>

              <KeyValueRow label="Start Date" value={formatDate(project.startDate)} />
              <KeyValueRow label="Requested Launch Date" value={formatDate(project.targetLaunchDate)} />
              <KeyValueRow
                label="Forecast End Date (Effort-Based)"
                value={effortEndDate ? formatDate(effortEndDate) : "—"}
              />
              <KeyValueRow
                label="Total WBS Effort"
                value={totalHours > 0 ? `${totalHours} hrs` : "—"}
              />
              <KeyValueRow label="Deadline Flexibility" value={project.deadlineFlexibility} />
              <KeyValueRow label="Deadline Driver" value={project.deadlineDriver} />
              <KeyValueRow label="Development Level" value={project.developmentType} />
              <KeyValueRow label="Baseline Owner" value={userName(project.ownerId)} />
              <KeyValueRow label="Approver" value={userName(project.approverId)} />
              <div className="flex items-start justify-between py-2 gap-4">
                <span className="text-[12px] text-gray-500 font-medium shrink-0 w-44">Status</span>
                <span className="text-right">
                  <StatusBadge status={project.baselineStatus} />
                </span>
              </div>
            </div>

            {/* Timeline Comparison card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-[13px] font-bold text-[#0F2240] mb-1 uppercase tracking-wide">
                Timeline Comparison
              </h2>
              <p className="text-[11px] text-gray-400 mb-4">
                Relative durations from project start date.
              </p>

              <TimelineBar
                label="Requested Launch"
                color="#3B82F6"
                days={targetDays}
                maxDays={maxBarDays}
                date={formatDate(project.targetLaunchDate)}
              />
              <TimelineBar
                label="Effort-Based End"
                color="#9CA3AF"
                days={effortDaysFromStart}
                maxDays={maxBarDays}
                date={effortEndDate ? formatDate(effortEndDate) : "—"}
              />
              <TimelineBar
                label={baselineStatus === "Approved" ? "Locked Baseline" : "Proposed Baseline"}
                color="#14B8A6"
                days={baselineStatus === "Approved" ? baselineDaysFromStart : proposedDays}
                maxDays={maxBarDays}
                date={
                  baselineStatus === "Approved"
                    ? formatDate(project.baselineEndDate)
                    : proposedBaselineDate
                    ? formatDate(proposedBaselineDate)
                    : "—"
                }
              />

              <div className="flex items-center gap-5 mt-4 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-blue-400" />
                  <span className="text-[11px] text-gray-500">Requested</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-gray-400" />
                  <span className="text-[11px] text-gray-500">Effort-Based</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: "#14B8A6" }} />
                  <span className="text-[11px] text-gray-500">
                    {baselineStatus === "Approved" ? "Locked Baseline" : "Proposed Baseline"}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ─── Right col (2/5) ────────────────────────────────────────── */}
          <div className="col-span-2 space-y-5">
            {/* Approval Actions card */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <h2 className="text-[13px] font-bold text-[#0F2240] mb-4 uppercase tracking-wide">
                Approval Actions
              </h2>

              {actionError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-3">
                  <p className="text-[12px] text-red-700">{actionError}</p>
                </div>
              )}

              {/* ── Owner actions ─────────────────────────────────────── */}
              {showOwnerActions && (
                <div className="space-y-3">
                  {baselineStatus === "Rejected" && baselineRejectionComment && (
                    <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                      <p className="text-[11px] font-semibold text-red-600 mb-0.5">Feedback from approver</p>
                      <p className="text-[12px] text-red-800">{baselineRejectionComment}</p>
                    </div>
                  )}

                  <div className="bg-gray-50 rounded-lg px-3 py-2.5 mb-1">
                    <p className="text-[11px] text-gray-500 font-medium mb-1">Proposed Baseline Date</p>
                    <p className="text-[14px] font-bold text-[#0F2240]">
                      {proposedBaselineDate ? formatDate(proposedBaselineDate) : "—"}
                    </p>
                    {effortEndDate && (
                      <p className="text-[10px] text-gray-400 mt-0.5">Based on WBS effort ({totalHours} hrs)</p>
                    )}
                  </div>

                  <button
                    onClick={submitBaseline}
                    disabled={submitting}
                    className="w-full py-3 rounded-xl text-[13px] font-semibold text-white transition-opacity disabled:opacity-50"
                    style={{ backgroundColor: "#14B8A6" }}
                  >
                    {submitting ? "Submitting…" : "Submit for Approval"}
                  </button>
                </div>
              )}

              {/* ── Approver actions ──────────────────────────────────── */}
              {showApproverActions && (
                <div className="space-y-3">
                  <div className="bg-gray-50 rounded-lg px-3 py-2.5">
                    <p className="text-[11px] text-gray-500 font-medium mb-1">Proposed Baseline Date</p>
                    <p className="text-[14px] font-bold text-[#0F2240]">
                      {proposedBaselineDate ? formatDate(proposedBaselineDate) : "—"}
                    </p>
                    {effortEndDate && (
                      <p className="text-[10px] text-gray-400 mt-0.5">Based on WBS effort ({totalHours} hrs)</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1">
                      Approval Comments (optional)
                    </label>
                    <textarea
                      value={approvalComment}
                      onChange={(e) => setApprovalComment(e.target.value)}
                      rows={2}
                      placeholder="Add a note for the record…"
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[12px] text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent"
                    />
                  </div>

                  <button
                    onClick={approveBaseline}
                    disabled={submitting}
                    className="w-full py-3 rounded-xl text-[13px] font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-50"
                  >
                    {submitting ? "Approving…" : "Approve & Set Baseline"}
                  </button>

                  {!showRequestChangesComment ? (
                    <button
                      onClick={() => {
                        setShowRequestChangesComment(true);
                        setShowRejectComment(false);
                      }}
                      className="w-full py-3 rounded-xl text-[13px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
                    >
                      Request Changes
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <label className="block text-[11px] font-semibold text-gray-600">
                        What changes are needed? <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={requestChangesComment}
                        onChange={(e) => setRequestChangesComment(e.target.value)}
                        rows={3}
                        placeholder="Describe the changes required…"
                        className="w-full border border-amber-200 rounded-lg px-3 py-2 text-[12px] text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={requestChanges}
                          disabled={submitting || !requestChangesComment.trim()}
                          className="flex-1 py-2.5 rounded-xl text-[12px] font-semibold text-white bg-amber-500 hover:bg-amber-600 transition-colors disabled:opacity-50"
                        >
                          Send Feedback
                        </button>
                        <button
                          onClick={() => {
                            setShowRequestChangesComment(false);
                            setRequestChangesComment("");
                          }}
                          className="px-4 py-2.5 rounded-xl text-[12px] font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {!showRejectComment ? (
                    <button
                      onClick={() => {
                        setShowRejectComment(true);
                        setShowRequestChangesComment(false);
                      }}
                      className="w-full py-2.5 rounded-xl text-[13px] font-semibold text-red-600 border border-red-200 hover:bg-red-50 transition-colors"
                    >
                      Reject Project
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <label className="block text-[11px] font-semibold text-red-600">
                        Rejection reason <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={rejectComment}
                        onChange={(e) => setRejectComment(e.target.value)}
                        rows={3}
                        placeholder="Explain why this project is being rejected…"
                        className="w-full border border-red-200 rounded-lg px-3 py-2 text-[12px] text-gray-700 resize-none focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={rejectProject}
                          disabled={submitting || !rejectComment.trim()}
                          className="flex-1 py-2.5 rounded-xl text-[12px] font-semibold text-white bg-red-500 hover:bg-red-600 transition-colors disabled:opacity-50"
                        >
                          Confirm Rejection
                        </button>
                        <button
                          onClick={() => {
                            setShowRejectComment(false);
                            setRejectComment("");
                          }}
                          className="px-4 py-2.5 rounded-xl text-[12px] font-semibold text-gray-500 bg-gray-100 hover:bg-gray-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Approved / locked state ───────────────────────────── */}
              {showLockedState && (
                <div className="space-y-3">
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-4 text-center">
                    <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-2">
                      <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <p className="text-[12px] font-bold text-emerald-700">Baseline is locked</p>
                    <p className="text-[11px] text-emerald-600 mt-0.5">
                      Locked end date:{" "}
                      <span className="font-semibold">{formatDate(project.baselineEndDate)}</span>
                    </p>
                  </div>
                </div>
              )}

              {/* ── No actions (viewer) ───────────────────────────────── */}
              {!showOwnerActions && !showApproverActions && !showLockedState && (
                <div className="text-center py-6">
                  <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <p className="text-[12px] text-gray-400 font-medium">No actions available</p>
                  <p className="text-[11px] text-gray-300 mt-0.5">
                    You don&apos;t have permission to take action on this baseline.
                  </p>
                </div>
              )}
            </div>

            {/* Change History collapsible */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="w-full flex items-center justify-between text-left"
              >
                <h2 className="text-[13px] font-bold text-[#0F2240] uppercase tracking-wide">
                  Change History
                </h2>
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showHistory ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showHistory && (
                <div className="mt-3">
                  {activity.length === 0 ? (
                    <p className="text-[12px] text-gray-400 text-center py-4">No activity recorded yet.</p>
                  ) : (
                    <div className="space-y-0">
                      {activity.map((entry) => (
                        <ActivityEntry key={entry.id} entry={entry} />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!showHistory && (
                <p className="text-[11px] text-gray-400 mt-1">
                  {activity.length} event{activity.length !== 1 ? "s" : ""} recorded
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Action Bar ────────────────────────────────────────────── */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link
            to={`/projects/${id}/capacity`}
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-gray-600 hover:text-[#0F2240] transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Capacity Check
          </Link>

          {baselineStatus === "Approved" && (
            <Link
              to={`/projects/${id}`}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[13px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ backgroundColor: "#0F2240" }}
            >
              View Project Dashboard
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
