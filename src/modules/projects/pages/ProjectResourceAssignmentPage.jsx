import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, Link } from "react-router-dom";
import PlanningFlowNav from "../components/PlanningFlowNav";
import {
  doc,
  collection,
  query,
  orderBy,
  onSnapshot,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { userWeeklyProjectHours } from "../../../lib/bandwidth";

// ---------------------------------------------------------------------------
// Role → jobTitle matching (duplicated here; not exported from RoleDemandPage)
// ---------------------------------------------------------------------------
const ROLE_MATCHERS = {
  "Project Owner": (jt) => /director|supervisor|project owner/i.test(jt),
  "Instructional Designer": (jt) =>
    jt.trim().toLowerCase() === "instructional designer",
  "Content Developer": (jt) =>
    jt.trim().toLowerCase() === "content developer",
  "QA Reviewer": (jt) => /qa reviewer|quality/i.test(jt),
  SME: (jt) => jt.trim().toLowerCase() === "sme",
  "L&D Supervisor": (jt) => jt.trim().toLowerCase() === "l&d supervisor",
};

function matchUsersToRole(users, role) {
  const matcher =
    ROLE_MATCHERS[role] ??
    ((jt) => jt.trim().toLowerCase() === role.trim().toLowerCase());
  return users.filter((u) => matcher(u.jobTitle ?? ""));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function getInitials(name = "") {
  return name
    .split(" ")
    .map((p) => p[0] ?? "")
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function planningWeeksFromWindow(window) {
  return parseInt(window, 10) || 8;
}

function getAvailabilityLabel(remaining) {
  if (remaining > 5)
    return { label: `Available (${remaining.toFixed(1)}h remaining)`, cls: "bg-emerald-100 text-emerald-700" };
  if (remaining >= 0)
    return { label: `Tight (${remaining.toFixed(1)}h remaining)`, cls: "bg-yellow-100 text-yellow-700" };
  return {
    label: `Overallocated (${Math.abs(remaining).toFixed(1)}h short)`,
    cls: "bg-red-100 text-red-700",
  };
}

function roleDocId(role) {
  return role.replace(/\s+/g, "_");
}

// ---------------------------------------------------------------------------
// Toast component
// ---------------------------------------------------------------------------
function Toast({ message, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed bottom-6 right-6 z-50 bg-gray-900 text-white text-sm px-4 py-3 rounded-xl shadow-lg animate-fade-in">
      {message}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person picker dropdown
// ---------------------------------------------------------------------------
function PersonPicker({ role, eligibleUsers, currentUserId, onSelect }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  const currentUser = eligibleUsers.find((u) => u.id === currentUserId) ?? null;

  useEffect(() => {
    function handler(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
          currentUser
            ? "border-gray-200 bg-white hover:border-teal-400"
            : "border-dashed border-gray-300 bg-gray-50 hover:border-teal-400 text-gray-400"
        }`}
      >
        {currentUser ? (
          <>
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-teal-500 text-white text-xs font-semibold shrink-0">
              {getInitials(currentUser.name)}
            </span>
            <span className="text-gray-800 font-medium">{currentUser.name}</span>
          </>
        ) : (
          <span className="italic">— Unassigned —</span>
        )}
        <svg
          className="ml-auto w-4 h-4 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-10 mt-1 w-64 bg-white border border-gray-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
          <button
            type="button"
            className="w-full text-left px-4 py-2 text-sm text-gray-400 hover:bg-gray-50 italic"
            onClick={() => { onSelect(null); setOpen(false); }}
          >
            — Unassigned —
          </button>
          {eligibleUsers.length === 0 && (
            <p className="px-4 py-3 text-sm text-gray-400">No eligible users found.</p>
          )}
          {eligibleUsers.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => { onSelect(u.id); setOpen(false); }}
              className={`w-full text-left flex items-center gap-3 px-4 py-2 text-sm hover:bg-teal-50 transition-colors ${
                u.id === currentUserId ? "bg-teal-50 font-semibold" : ""
              }`}
            >
              <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-teal-500 text-white text-xs font-semibold shrink-0">
                {getInitials(u.name)}
              </span>
              <span className="flex flex-col min-w-0">
                <span className="truncate text-gray-800">{u.name}</span>
                <span className="text-[10px] text-gray-400 truncate">{u.jobTitle}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignment row
// ---------------------------------------------------------------------------
function AssignmentRow({
  role,
  hoursNeeded,
  eligibleUsers,
  allUsers,
  assignment,
  planningWeeks,
  onSave,
}) {
  const [allocationPct, setAllocationPct] = useState(
    assignment?.allocationPct ?? 100
  );
  const [notes, setNotes] = useState(assignment?.notes ?? "");
  const [smeName, setSmeName] = useState(assignment?.smeName ?? "");

  useEffect(() => {
    setAllocationPct(assignment?.allocationPct ?? 100);
    setNotes(assignment?.notes ?? "");
    setSmeName(assignment?.smeName ?? "");
  }, [assignment?.allocationPct, assignment?.notes, assignment?.smeName]);

  const isSME = role === "SME";

  const assignedUser = useMemo(() => {
    if (!assignment?.userId) return null;
    return allUsers.find((u) => u.id === assignment.userId) ?? null;
  }, [allUsers, assignment?.userId]);

  const allocatedHrs = hoursNeeded * (allocationPct / 100);

  const availabilityInfo = useMemo(() => {
    if (!assignedUser) return null;
    const available = userWeeklyProjectHours(assignedUser) * planningWeeks;
    const remaining = available - allocatedHrs;
    return { available, remaining, ...getAvailabilityLabel(remaining) };
  }, [assignedUser, planningWeeks, allocatedHrs]);

  function handleSelectUser(userId) {
    onSave(role, { userId, allocationPct, notes, smeName });
  }

  function handleAllocationBlur() {
    const pct = Math.min(100, Math.max(0, Number(allocationPct) || 0));
    setAllocationPct(pct);
    onSave(role, {
      userId: assignment?.userId ?? null,
      allocationPct: pct,
      notes,
      smeName,
    });
  }

  function handleNotesBlur() {
    onSave(role, {
      userId: assignment?.userId ?? null,
      allocationPct,
      notes,
      smeName,
    });
  }

  function handleSmeBlur() {
    onSave(role, {
      userId: assignment?.userId ?? null,
      allocationPct,
      notes,
      smeName,
    });
  }

  const isOverallocated = availabilityInfo && availabilityInfo.remaining < 0;

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      {/* Required Role */}
      <td className="px-4 py-4 align-top">
        <p className="font-semibold text-gray-800 text-sm">{role}</p>
        <p className="text-[11px] text-gray-400 mt-0.5">{hoursNeeded}h total</p>
      </td>

      {/* Hours Needed */}
      <td className="px-4 py-4 align-top text-sm text-gray-700 font-medium">
        {hoursNeeded}h
      </td>

      {/* Assigned To */}
      <td className="px-4 py-4 align-top">
        {isSME ? (
          <input
            type="text"
            value={smeName}
            onChange={(e) => setSmeName(e.target.value)}
            onBlur={handleSmeBlur}
            placeholder="Enter SME name…"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        ) : (
          <PersonPicker
            role={role}
            eligibleUsers={eligibleUsers}
            currentUserId={assignment?.userId ?? null}
            onSelect={handleSelectUser}
          />
        )}
      </td>

      {/* Allocation % */}
      <td className="px-4 py-4 align-top">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={0}
            max={100}
            value={allocationPct}
            onChange={(e) => setAllocationPct(e.target.value)}
            onBlur={handleAllocationBlur}
            className="w-16 border border-gray-200 rounded-lg px-2 py-2 text-sm text-center focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          <span className="text-sm text-gray-500">%</span>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">
          = {allocatedHrs.toFixed(1)}h of {hoursNeeded}h needed
        </p>
      </td>

      {/* Availability */}
      <td className="px-4 py-4 align-top">
        {availabilityInfo ? (
          <div className="space-y-1">
            <p className="text-[11px] text-gray-500">
              {availabilityInfo.available.toFixed(1)}h available
            </p>
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-[11px] font-medium ${availabilityInfo.cls}`}
            >
              {availabilityInfo.label}
            </span>
          </div>
        ) : (
          <span className="text-gray-300 text-sm">—</span>
        )}
      </td>

      {/* Notes / Status */}
      <td className="px-4 py-4 align-top">
        <div className="flex items-start gap-1">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleNotesBlur}
            placeholder="Notes…"
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-full focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
          {isOverallocated && (
            <span title="Overallocated" className="text-yellow-500 text-base mt-2 shrink-0">
              ⚠
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function ProjectResourceAssignmentPage() {
  const { id } = useParams();

  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [users, setUsers] = useState(null);
  const [assignments, setAssignments] = useState(null);
  const [planningWindow, setPlanningWindow] = useState("8");
  const [toast, setToast] = useState(null);

  const planningWeeks = planningWeeksFromWindow(planningWindow);

  // ---- Firestore subscriptions ----
  useEffect(() => {
    const unsub = onSnapshot(doc(db, "projects", id), (snap) => {
      if (snap.exists()) setProject({ id: snap.id, ...snap.data() });
    });
    return unsub;
  }, [id]);

  useEffect(() => {
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
    const unsub = onSnapshot(
      collection(db, "projects", id, "assignments"),
      (snap) => {
        const map = {};
        snap.docs.forEach((d) => {
          map[d.id] = { id: d.id, ...d.data() };
        });
        setAssignments(map);
      }
    );
    return unsub;
  }, [id]);

  // ---- Derived: role demand from WBS top-level tasks ----
  const roleDemand = useMemo(() => {
    if (!tasks) return [];
    const topLevel = tasks.filter(
      (t) => t.parentTaskId === null || t.parentTaskId === undefined
    );
    const map = {};
    topLevel.forEach((t) => {
      const role = t.responsibleRole;
      if (!role) return;
      if (!map[role]) map[role] = 0;
      map[role] += Number(t.estimatedHours) || 0;
    });
    return Object.entries(map).map(([role, hoursNeeded]) => ({
      role,
      hoursNeeded,
    }));
  }, [tasks]);

  // ---- Save handler ----
  async function saveAssignment(role, data) {
    const docId = roleDocId(role);
    const payload = {
      role,
      userId: data.userId ?? null,
      allocationPct: data.allocationPct ?? 100,
      notes: data.notes ?? "",
      smeName: data.smeName ?? "",
      updatedAt: serverTimestamp(),
    };
    await setDoc(doc(db, "projects", id, "assignments", docId), payload, {
      merge: true,
    });

    // Check if all roles are now assigned
    const updatedAssignments = {
      ...(assignments ?? {}),
      [docId]: payload,
    };
    const allAssigned = roleDemand.every((rd) => {
      const a = updatedAssignments[roleDocId(rd.role)];
      return a && (a.userId || (rd.role === "SME" && a.smeName));
    });

    if (
      allAssigned &&
      roleDemand.length > 0 &&
      project?.planningStatus === "WBS Pending"
    ) {
      await updateDoc(doc(db, "projects", id), {
        planningStatus: "Resource Check",
        updatedAt: serverTimestamp(),
      });
      showToast("All roles assigned — ready for capacity check.");
    }
  }

  function showToast(message) {
    setToast(message);
  }

  // ---- Auto Suggest ----
  async function handleAutoSuggest() {
    if (!users || roleDemand.length === 0) return;
    let anyAssigned = false;

    for (const { role, hoursNeeded } of roleDemand) {
      const docId = roleDocId(role);
      const existing = assignments?.[docId];
      if (existing?.userId) continue;

      const eligible = matchUsersToRole(users, role);
      if (eligible.length === 0) continue;

      const best = eligible.reduce((prev, curr) => {
        const prevCap =
          userWeeklyProjectHours(prev) * planningWeeks - hoursNeeded;
        const currCap =
          userWeeklyProjectHours(curr) * planningWeeks - hoursNeeded;
        return currCap > prevCap ? curr : prev;
      });

      await saveAssignment(role, {
        userId: best.id,
        allocationPct: 100,
        notes: existing?.notes ?? "",
        smeName: existing?.smeName ?? "",
      });
      anyAssigned = true;
    }

    if (anyAssigned) {
      showToast("Auto Suggest complete — best available members assigned.");
    } else {
      showToast("All roles already assigned or no eligible users found.");
    }
  }

  // ---- Loading guard (all hooks above) ----
  const loading =
    project === null ||
    tasks === null ||
    users === null ||
    assignments === null;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-teal-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-500 text-sm">Loading resource assignment…</p>
        </div>
      </div>
    );
  }

  const statusColors = {
    "WBS Pending": "bg-yellow-100 text-yellow-700",
    "Resource Check": "bg-blue-100 text-blue-700",
    Approved: "bg-emerald-100 text-emerald-700",
    Draft: "bg-gray-100 text-gray-600",
  };
  const statusCls =
    statusColors[project.planningStatus] ?? "bg-gray-100 text-gray-600";

  return (
    <div className="min-h-screen bg-gray-50">
      <PlanningFlowNav project={project} projectId={id} />
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                              */}
      {/* ------------------------------------------------------------------ */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-[#0F2240]">
                Resource Assignment
              </h1>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-700">
                  {project.name}
                </span>
                {project.projectCode && (
                  <span className="px-2 py-0.5 bg-[#0F2240]/10 text-[#0F2240] text-xs font-mono rounded-md">
                    {project.projectCode}
                  </span>
                )}
                {project.ticketNumber && (
                  <span className="px-2 py-0.5 bg-gray-100 text-gray-500 text-xs font-mono rounded-md">
                    {project.ticketNumber}
                  </span>
                )}
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusCls}`}
                >
                  {project.planningStatus ?? "—"}
                </span>
              </div>
            </div>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
              Assign team members to each required role. Allocation % controls
              how much of the role's WBS hours this person is responsible for.
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 font-medium whitespace-nowrap">
                Planning window
              </label>
              <select
                value={planningWindow}
                onChange={(e) => setPlanningWindow(e.target.value)}
                className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-400"
              >
                <option value="4">4 weeks</option>
                <option value="8">8 weeks</option>
                <option value="12">12 weeks</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => showToast("Coming soon")}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
            >
              Bulk Assign
            </button>

            <button
              type="button"
              onClick={handleAutoSuggest}
              className="px-4 py-2 rounded-lg bg-teal-500 text-white text-sm font-medium hover:bg-teal-600 transition-colors"
            >
              Auto Suggest
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Main content                                                        */}
      {/* ------------------------------------------------------------------ */}
      <div className="px-6 py-6 max-w-screen-xl mx-auto">
        {roleDemand.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-10 text-center">
            <p className="text-gray-400 text-sm">
              No roles found in the WBS. Add tasks with roles assigned to get
              started.
            </p>
            <Link
              to={`/projects/${id}/wbs`}
              className="mt-4 inline-block text-sm text-teal-600 hover:underline"
            >
              Go to WBS →
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-gray-100">
                <thead className="bg-gray-50">
                  <tr>
                    {[
                      "Required Role",
                      "Hours Needed",
                      "Assigned To",
                      "Allocation %",
                      `Availability (Next ${planningWeeks} Weeks)`,
                      "Notes / Status",
                    ].map((col) => (
                      <th
                        key={col}
                        className="px-4 py-3 text-left text-[10px] uppercase tracking-wider text-gray-500 font-semibold whitespace-nowrap"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {roleDemand.map(({ role, hoursNeeded }) => {
                    const docId = roleDocId(role);
                    const assignment = assignments[docId] ?? null;
                    // All project team members can be assigned to any role
                    const eligibleUsers = users.filter(
                      (u) => project?.memberIds?.includes(u.id)
                    );

                    return (
                      <AssignmentRow
                        key={role}
                        role={role}
                        hoursNeeded={hoursNeeded}
                        eligibleUsers={eligibleUsers}
                        allUsers={users}
                        assignment={assignment}
                        planningWeeks={planningWeeks}
                        onSave={saveAssignment}
                      />
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Summary cards */}
        {roleDemand.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                Roles Assigned
              </p>
              <p className="text-2xl font-bold text-[#0F2240] mt-1">
                {
                  roleDemand.filter((rd) => {
                    const a = assignments[roleDocId(rd.role)];
                    return a?.userId || (rd.role === "SME" && a?.smeName);
                  }).length
                }
                <span className="text-base font-normal text-gray-400">
                  {" "}/ {roleDemand.length}
                </span>
              </p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                Total Hours Needed
              </p>
              <p className="text-2xl font-bold text-[#0F2240] mt-1">
                {roleDemand
                  .reduce((s, rd) => s + rd.hoursNeeded, 0)
                  .toFixed(0)}
                h
              </p>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 shadow-sm px-5 py-4">
              <p className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                Overallocated Roles
              </p>
              <p className="text-2xl font-bold text-[#0F2240] mt-1">
                {
                  roleDemand.filter((rd) => {
                    const a = assignments[roleDocId(rd.role)];
                    if (!a?.userId) return false;
                    const user = users.find((u) => u.id === a.userId);
                    if (!user) return false;
                    const available =
                      userWeeklyProjectHours(user) * planningWeeks;
                    const allocated =
                      rd.hoursNeeded * ((a.allocationPct ?? 100) / 100);
                    return available - allocated < 0;
                  }).length
                }
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Bottom action bar                                                   */}
      {/* ------------------------------------------------------------------ */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4">
        <div className="max-w-screen-xl mx-auto flex items-center justify-between">
          <Link
            to={`/projects/${id}/role-demand`}
            className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-teal-600 transition-colors"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            View Role Demand
          </Link>

          <Link
            to={`/projects/${id}/capacity`}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0F2240] text-white text-sm font-medium rounded-lg hover:bg-[#0F2240]/90 transition-colors"
          >
            Run Capacity Check
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </Link>
        </div>
      </div>

      {/* Toast */}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </div>
  );
}
