import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";

export default function Dashboard() {
  const { user } = useAuth();
  const [pendingApprovals, setPendingApprovals] = useState([]);

  useEffect(() => {
    const q = query(
      collection(db, "projects"),
      where("approverId", "==", user.uid),
      where("baselineStatus", "==", "Pending Approval")
    );
    const unsub = onSnapshot(q, (snap) => {
      setPendingApprovals(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return unsub;
  }, [user]);

  return (
    <div>
      <h2 className="text-xl font-bold font-heading text-navy mb-0.5">Dashboard</h2>
      <p className="text-xs text-gray-500 mb-4">Welcome to Meridian.</p>

      {pendingApprovals.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3.5 mb-4">
          <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wide mb-2">
            Pending Your Approval
          </div>
          <div className="space-y-1.5">
            {pendingApprovals.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-[13px]">
                <Link to={`/projects/${p.id}`} className="text-navy underline">
                  {p.name}
                </Link>
                <span className="text-amber-700">Proposed: {p.proposedBaselineEndDate}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {["Active Projects", "Overdue Tasks", "Team Bandwidth"].map((label) => (
          <div key={label} className="bg-white rounded-lg shadow-sm border border-gray-100 p-3.5">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide font-medium mb-1">{label}</p>
            <p className="text-2xl font-bold text-navy">—</p>
          </div>
        ))}
      </div>
    </div>
  );
}
