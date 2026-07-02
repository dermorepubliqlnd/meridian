import { useEffect, useState } from "react";
import { collection, collectionGroup, doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import { getBand, computeUserBandwidth } from "../../../lib/bandwidth";

// ── OoO helpers ───────────────────────────────────────────────────────────────
function ruid() { return Math.random().toString(36).slice(2, 9); }

function fmtRange(from, to) {
  if (!from) return "—";
  if (!to || to === from) return from;
  return `${from} → ${to}`;
}

// ── Bandwidth bar ─────────────────────────────────────────────────────────────
function BandwidthBar({ pct }) {
  const band = getBand(pct);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className={`px-1.5 py-0.5 rounded font-medium text-[10px] ${band.style}`}>{band.label}</span>
        <span className="text-gray-500 font-mono">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${band.bar}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  );
}

// ── OoO panel (per user) ──────────────────────────────────────────────────────
function OoOPanel({ userId, timeOff, canEdit, onUpdate }) {
  const [adding, setAdding]   = useState(false);
  const [form,   setForm]     = useState({ from: "", to: "", note: "" });
  const [saving, setSaving]   = useState(false);

  const handleAdd = async () => {
    if (!form.from) return;
    setSaving(true);
    const entry = { id: ruid(), from: form.from, to: form.to || form.from, note: form.note.trim() };
    const ref = doc(db, "users", userId);
    const snap = await getDoc(ref);
    const existing = snap.data()?.timeOff || [];
    const updated = [...existing, entry].sort((a, b) => a.from.localeCompare(b.from));
    await updateDoc(ref, { timeOff: updated });
    onUpdate(userId, updated);
    setForm({ from: "", to: "", note: "" });
    setAdding(false);
    setSaving(false);
  };

  const handleRemove = async (id) => {
    const ref = doc(db, "users", userId);
    const snap = await getDoc(ref);
    const updated = (snap.data()?.timeOff || []).filter((e) => e.id !== id);
    await updateDoc(ref, { timeOff: updated });
    onUpdate(userId, updated);
  };

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (timeOff || []).filter((e) => (e.to || e.from) >= today);
  const past     = (timeOff || []).filter((e) => (e.to || e.from) < today);

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Time Off</span>
        {canEdit && !adding && (
          <button onClick={() => setAdding(true)} className="text-[11px] text-teal-600 hover:text-teal-800">+ Add</button>
        )}
      </div>

      {adding && (
        <div className="bg-slate-50 rounded-md p-2.5 mb-2 space-y-1.5">
          <div className="flex gap-1.5">
            <div className="flex-1">
              <label className="text-[10px] text-gray-400 block mb-0.5">From</label>
              <input type="date" value={form.from} min={today} onChange={(e) => setForm((p) => ({ ...p, from: e.target.value }))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-gray-400 block mb-0.5">To</label>
              <input type="date" value={form.to} min={form.from || today} onChange={(e) => setForm((p) => ({ ...p, to: e.target.value }))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal" />
            </div>
          </div>
          <input placeholder="Note (optional)" value={form.note} onChange={(e) => setForm((p) => ({ ...p, note: e.target.value }))}
            className="w-full border border-gray-300 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal" />
          <div className="flex gap-1.5">
            <button onClick={handleAdd} disabled={saving || !form.from} className="flex-1 text-[11px] bg-navy text-white rounded px-2 py-1 disabled:opacity-40">
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setAdding(false)} className="text-[11px] text-gray-400 px-2">Cancel</button>
          </div>
        </div>
      )}

      {upcoming.length === 0 && past.length === 0 && !adding && (
        <p className="text-[11px] text-gray-300 italic">No time off logged.</p>
      )}

      {upcoming.map((e) => (
        <div key={e.id} className="flex items-center justify-between py-1 group">
          <div>
            <span className="text-[12px] text-gray-700">{fmtRange(e.from, e.to)}</span>
            {e.note && <span className="text-[11px] text-gray-400 ml-1.5">— {e.note}</span>}
          </div>
          {canEdit && (
            <button onClick={() => handleRemove(e.id)} className="text-[10px] text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition">✕</button>
          )}
        </div>
      ))}

      {past.length > 0 && (
        <details className="mt-1">
          <summary className="text-[11px] text-gray-400 cursor-pointer">Past ({past.length})</summary>
          {past.map((e) => (
            <div key={e.id} className="text-[11px] text-gray-400 py-0.5 pl-2">{fmtRange(e.from, e.to)} {e.note && `— ${e.note}`}</div>
          ))}
        </details>
      )}
    </div>
  );
}

// ── User card ─────────────────────────────────────────────────────────────────
function UserCard({ person, tasks, workCalendar, currentUserId, isAdmin }) {
  const [expanded, setExpanded] = useState(false);
  const [timeOff, setTimeOff]   = useState(person.timeOff || []);
  const canEdit = isAdmin || person.id === currentUserId;

  const bw = computeUserBandwidth(tasks, person.id, workCalendar);
  const band = bw.band;

  const activeTasks = bw.tasks.filter((t) => t.status !== "Not Started");
  const initials = person.name?.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2) || "?";

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0 ${band.bar}`}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-navy truncate">{person.name}</div>
          <div className="text-[11px] text-gray-400 truncate">{person.jobTitle || person.role}</div>
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-gray-400 hover:text-gray-600 shrink-0">
          {expanded ? "▲ Less" : "▼ More"}
        </button>
      </div>

      {/* Bandwidth */}
      <BandwidthBar pct={bw.pct} />
      <div className="flex items-center justify-between text-[11px] text-gray-400 mt-1.5">
        <span>{bw.outstandingHours} outstanding hrs</span>
        <span>{bw.tasks.length} task{bw.tasks.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Expanded section */}
      {expanded && (
        <>
          {/* Active tasks */}
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">Active Tasks</div>
            {activeTasks.length === 0 && (
              <p className="text-[11px] text-gray-300 italic">No in-progress tasks.</p>
            )}
            {activeTasks.map((t) => (
              <div key={t.id} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                <span className="text-[12px] text-gray-700 truncate flex-1">{t.name}</span>
                <span className="text-[11px] text-gray-400 ml-2 shrink-0">{t.estimatedHours ?? 0}h</span>
              </div>
            ))}
            {bw.tasks.length > activeTasks.length && (
              <p className="text-[11px] text-gray-400 mt-1">{bw.tasks.length - activeTasks.length} not-yet-started task{bw.tasks.length - activeTasks.length !== 1 ? "s" : ""} also counted in bandwidth.</p>
            )}
          </div>

          {/* Time off */}
          <OoOPanel
            userId={person.id}
            timeOff={timeOff}
            canEdit={canEdit}
            onUpdate={(uid, updated) => setTimeOff(updated)}
          />
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
const BAND_FILTER_OPTIONS = [
  { value: "all",        label: "All" },
  { value: "Available",  label: "Available" },
  { value: "Healthy",    label: "Healthy" },
  { value: "Full",       label: "Full" },
  { value: "At Risk",    label: "At Risk" },
  { value: "Overloaded", label: "Overloaded" },
];

export default function ResourcesPage() {
  const { user, profile } = useAuth();

  const [people,       setPeople]       = useState([]);
  const [tasks,        setTasks]        = useState([]);
  const [workCalendar, setWorkCalendar] = useState({ dailyCapacityHours: 8, workDaysPerWeek: 5 });
  const [bandFilter,   setBandFilter]   = useState("all");
  const [search,       setSearch]       = useState("");

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "users"), (snap) =>
      setPeople(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(collectionGroup(db, "tasks"), (snap) =>
      setTasks(snap.docs.map((d) => ({ id: d.id, projectId: d.ref.parent.parent.id, ...d.data() }))));
    getDoc(doc(db, "settings", "workCalendar")).then((snap) => {
      if (snap.exists()) setWorkCalendar(snap.data());
    });
    return () => { u1(); u2(); };
  }, []);

  const isAdmin = profile?.role === "Admin";

  // Visible people: Admins see everyone, Contributors see teammates (non-Exec)
  const visiblePeople = isAdmin
    ? people
    : people.filter((p) => p.role !== "Exec Viewer");

  // Filter + search
  const filtered = visiblePeople.filter((p) => {
    if (search && !p.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (bandFilter !== "all") {
      const bw = computeUserBandwidth(tasks, p.id, workCalendar);
      if (bw.band.label !== bandFilter) return false;
    }
    return true;
  });

  // Sort by bandwidth % desc
  const sorted = [...filtered].sort((a, b) => {
    const ba = computeUserBandwidth(tasks, a.id, workCalendar).pct;
    const bb = computeUserBandwidth(tasks, b.id, workCalendar).pct;
    return bb - ba;
  });

  // Team summary
  const teamBw = visiblePeople.map((p) => computeUserBandwidth(tasks, p.id, workCalendar));
  const totalOutstanding = teamBw.reduce((s, b) => s + b.outstandingHours, 0);
  const avgPct = teamBw.length ? Math.round(teamBw.reduce((s, b) => s + b.pct, 0) / teamBw.length) : 0;
  const overloaded = teamBw.filter((b) => b.pct > 110).length;

  return (
    <div>
      <div className="flex items-start justify-between mb-1">
        <div>
          <h2 className="text-xl font-bold font-heading text-navy mb-0.5">People & Resources</h2>
          <p className="text-[11px] text-gray-400">Bandwidth is based on outstanding task hours ÷ 4-week rolling capacity.</p>
        </div>
      </div>

      {/* Team summary strip */}
      <div className="grid grid-cols-4 gap-3 mb-4">
        {[
          { label: "Team Members",       value: visiblePeople.length },
          { label: "Team Avg Bandwidth", value: `${avgPct}%` },
          { label: "Total Outstanding",  value: `${totalOutstanding}h` },
          { label: "Overloaded",         value: overloaded, alert: overloaded > 0 },
        ].map(({ label, value, alert }) => (
          <div key={label} className={`bg-white rounded-lg border shadow-sm p-3 ${alert ? "border-red-200" : "border-gray-100"}`}>
            <div className={`text-xl font-bold font-heading ${alert ? "text-red-600" : "text-navy"}`}>{value}</div>
            <div className="text-[11px] text-gray-400">{label}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4">
        <input
          placeholder="Search people…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-gray-200 rounded-md px-3 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal w-44"
        />
        <select value={bandFilter} onChange={(e) => setBandFilter(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1.5 text-[12px] text-gray-600 focus:outline-none focus:ring-1 focus:ring-teal">
          {BAND_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label === "all" ? "All bandwidth" : o.label}</option>)}
        </select>
        <div className="flex gap-1.5 ml-auto items-center">
          {/* Bandwidth legend */}
          {[{label:"Available",cls:"bg-emerald-400"},{label:"Healthy",cls:"bg-teal-400"},{label:"Full",cls:"bg-yellow-400"},{label:"At Risk",cls:"bg-orange-400"},{label:"Overloaded",cls:"bg-red-400"}].map(({label,cls}) => (
            <div key={label} className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className={`w-2 h-2 rounded-full ${cls}`} />
              {label}
            </div>
          ))}
        </div>
      </div>

      {/* Cards grid */}
      {sorted.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center text-[12px] text-gray-400">
          {visiblePeople.length === 0 ? "No team members found. Add users in User Management." : "No results match your filter."}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {sorted.map((person) => (
            <UserCard
              key={person.id}
              person={person}
              tasks={tasks}
              workCalendar={workCalendar}
              currentUserId={user?.uid}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      )}
    </div>
  );
}
