import { useState } from "react";
import {
  collection, doc, setDoc, addDoc, getDocs, serverTimestamp,
} from "firebase/firestore";
import { db } from "../../../lib/firebase";

function roleDocId(role) {
  return role.toLowerCase().replace(/[^a-z0-9]/g, "-");
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function buildSeed(users) {
  const byTitle = (t) => users.filter((u) => (u.jobTitle ?? "").toLowerCase().includes(t.toLowerCase()));
  const ids  = byTitle("instructional designer");
  const cds  = byTitle("content developer");
  const sups = byTitle("supervisor");
  const dirs = byTitle("director");
  const trs  = byTitle("trainer");

  const ID1 = ids[0], ID2 = ids[1] || ids[0];
  const CD1 = cds[0], CD2 = cds[1] || cds[0];
  const SUP = sups[0], DIR = dirs[0], TR = trs[0];

  return [
    {
      meta: {
        name: "Skincare Basics E-Learning", projectCode: "LND-2026-T01",
        workType: "E-Learning", priority: "High",
        startDate: daysFromNow(0), targetLaunchDate: daysFromNow(42), baselineEndDate: daysFromNow(42),
        deadlineFlexibility: "Fixed", status: "Active", planningStatus: "Active", baselineStatus: "Approved",
        ownerId: ID1?.id ?? null, approverId: DIR?.id ?? null,
        memberIds: [ID1?.id, CD1?.id, DIR?.id].filter(Boolean),
        planningWeeks: 6,
        description: "Foundational skincare module for new Sales Associates. 6-week sprint.",
        createdAt: serverTimestamp(),
      },
      tasks: [
        { phase: "Research & Analysis",  role: "Instructional Designer", hours: 8,  order: 0 },
        { phase: "Learning Design",      role: "Instructional Designer", hours: 16, order: 1 },
        { phase: "Content Production",   role: "Content Developer",      hours: 20, order: 2 },
        { phase: "QA Review",            role: "L&D Supervisor",          hours: 8,  order: 3 },
        { phase: "SME Validation",       role: "SME",                    hours: 10, order: 4 },
      ],
      assignments: [
        { role: "Instructional Designer", userId: ID1?.id, allocationPct: 100 },
        { role: "Content Developer",      userId: CD1?.id, allocationPct: 100 },
        { role: "L&D Supervisor",         userId: SUP?.id, allocationPct: 50  },
      ],
    },
    {
      meta: {
        name: "New Employee Onboarding Program", projectCode: "LND-2026-T02",
        workType: "Blended", priority: "High",
        startDate: daysFromNow(14), targetLaunchDate: daysFromNow(70), baselineEndDate: daysFromNow(70),
        deadlineFlexibility: "Flexible", status: "Active", planningStatus: "Active", baselineStatus: "Approved",
        ownerId: SUP?.id ?? null, approverId: DIR?.id ?? null,
        memberIds: [ID2?.id, CD2?.id, SUP?.id, DIR?.id].filter(Boolean),
        planningWeeks: 8,
        description: "End-to-end onboarding for all new hires. 8-week blended program.",
        createdAt: serverTimestamp(),
      },
      tasks: [
        { phase: "Needs Analysis",       role: "Instructional Designer", hours: 12, order: 0 },
        { phase: "Curriculum Design",    role: "Instructional Designer", hours: 20, order: 1 },
        { phase: "Content Production",   role: "Content Developer",      hours: 24, order: 2 },
        { phase: "Facilitation Design",  role: "L&D Supervisor",         hours: 12, order: 3 },
        { phase: "Pilot & QA",           role: "L&D Supervisor",          hours: 10, order: 4 },
        { phase: "SME Coordination",     role: "SME",                    hours: 8,  order: 5 },
      ],
      assignments: [
        { role: "Instructional Designer", userId: ID2?.id, allocationPct: 100 },
        { role: "Content Developer",      userId: CD2?.id, allocationPct: 100 },
        { role: "L&D Supervisor",         userId: SUP?.id, allocationPct: 60  },
      ],
    },
    {
      meta: {
        name: "Compliance & Safety Refresher", projectCode: "LND-2026-T03",
        workType: "E-Learning", priority: "Medium",
        startDate: daysFromNow(35), targetLaunchDate: daysFromNow(84), baselineEndDate: daysFromNow(84),
        deadlineFlexibility: "Fixed", status: "Active", planningStatus: "Active", baselineStatus: "Approved",
        ownerId: ID1?.id ?? null, approverId: DIR?.id ?? null,
        memberIds: [ID1?.id, CD1?.id, TR?.id, DIR?.id].filter(Boolean),
        planningWeeks: 7,
        description: "Annual compliance refresher. ID1 + CD1 shared with T01 — triggers overallocation.",
        createdAt: serverTimestamp(),
      },
      tasks: [
        { phase: "Research & Analysis", role: "Instructional Designer", hours: 10, order: 0 },
        { phase: "Learning Design",     role: "Instructional Designer", hours: 12, order: 1 },
        { phase: "Content Production",  role: "Content Developer",      hours: 16, order: 2 },
        { phase: "Facilitation",        role: "Trainer",                hours: 10, order: 3 },
        { phase: "QA Review",           role: "L&D Supervisor",          hours: 6,  order: 4 },
      ],
      assignments: [
        { role: "Instructional Designer", userId: ID1?.id, allocationPct: 80 },
        { role: "Content Developer",      userId: CD1?.id, allocationPct: 80 },
        { role: "Trainer",                userId: TR?.id,  allocationPct: 50 },
      ],
    },
  ];
}

async function createProjects(users, withAssignments, addLog) {
  const projects = buildSeed(users);
  for (const proj of projects) {
    const projRef = doc(collection(db, "projects"));
    addLog(`Creating: ${proj.meta.name}...`);
    await setDoc(projRef, proj.meta);

    for (const t of proj.tasks) {
      await addDoc(collection(db, "projects", projRef.id, "tasks"), {
        title: t.phase, phase: t.phase, responsibleRole: t.role,
        estimatedHours: t.hours, actualHours: null,
        status: "Not Started", parentTaskId: null, order: t.order,
        createdAt: serverTimestamp(),
      });
    }
    addLog(`  ${proj.tasks.length} WBS tasks added.`);

    if (withAssignments) {
      let count = 0;
      for (const a of proj.assignments) {
        if (!a.userId) continue;
        await setDoc(doc(db, "projects", projRef.id, "assignments", roleDocId(a.role)), {
          role: a.role,
          assignees: [{ slotId: "slot-0", userId: a.userId, allocationPct: a.allocationPct, notes: "" }],
          smeName: "", updatedAt: serverTimestamp(),
        });
        count++;
      }
      addLog(`  ${count} resource assignments created.`);
    }
  }
}

export default function SeedTestData() {
  const [status, setStatus] = useState("idle");
  const [log,    setLog]    = useState([]);

  function addLog(msg) { setLog((l) => [...l, msg]); }

  async function run(withAssignments) {
    setStatus("running");
    setLog([]);
    try {
      addLog("Reading users...");
      const snap  = await getDocs(collection(db, "users"));
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      addLog(`Found ${users.length} users.`);
      await createProjects(users, withAssignments, addLog);
      addLog(withAssignments
        ? "Done! Open any T0x project > Role Demand to see real utilization."
        : "Done! Open any T0x project > WBS to review tasks.");
      setStatus("done");
    } catch (err) {
      addLog(`Error: ${err.message}`);
      setStatus("error");
    }
  }

  const busy = status === "running";
  const done = status === "done";

  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl p-5">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h3 className="text-[13px] font-bold text-gray-800">Load Capacity Planning Test Data</h3>
          <p className="text-[11px] text-gray-500 mt-0.5">
            Creates 3 projects with overlapping timelines. T01 and T03 share the same ID and CD to trigger overallocation detection.
          </p>
        </div>
        <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-200 rounded px-1.5 py-0.5 font-semibold ml-3 flex-shrink-0">DEV ONLY</span>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 mb-3 text-[11px] text-gray-600 space-y-0.5">
        <div><span className="font-semibold text-gray-700">T01</span> Skincare Basics — now → +6 weeks</div>
        <div><span className="font-semibold text-gray-700">T02</span> New Employee Onboarding — +2w → +10 weeks</div>
        <div><span className="font-semibold text-gray-700">T03</span> Compliance Refresher — +5w → +12 weeks (overlaps T01)</div>
      </div>

      {log.length > 0 && (
        <div className="bg-gray-900 rounded-lg px-3 py-2 mb-3 text-[11px] text-gray-300 font-mono space-y-0.5 max-h-32 overflow-y-auto">
          {log.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {done ? (
        <div className="text-[12px] text-emerald-600 font-medium">Test data loaded successfully.</div>
      ) : (
        <div className="flex gap-2">
          <button
            onClick={() => run(false)}
            disabled={busy}
            className="px-3 py-2 rounded-lg text-[12px] font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {busy ? "Creating..." : "Projects + WBS only"}
          </button>
          <button
            onClick={() => run(true)}
            disabled={busy}
            className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-[#0F2240] text-white hover:bg-[#0F2240]/90 disabled:opacity-40 transition-colors"
          >
            {busy ? "Creating..." : "Full test (includes assignments)"}
          </button>
        </div>
      )}
    </div>
  );
}
