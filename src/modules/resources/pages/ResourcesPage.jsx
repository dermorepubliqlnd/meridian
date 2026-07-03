import { useEffect, useState, useMemo } from "react";
import { collection, collectionGroup, doc, getDoc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../../../lib/firebase";
import { useAuth } from "../../../context/AuthContext";
import {
  getBand, computeUserBandwidth, computeDailyAllocation, getWorkingDaysInRange,
} from "../../../lib/bandwidth";

// ── Date helpers ──────────────────────────────────────────────────────────────
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function startOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow; // Monday
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}
function fmtDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}
function fmtMonth(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-PH", { month: "short" });
}
function dayLabel(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return { day: d.getDate(), dow: ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()] };
}
function fmtRange(from, to) {
  if (!from) return "—";
  if (!to || to === from) return from;
  return `${from} → ${to}`;
}

// ── Allocation cell color ─────────────────────────────────────────────────────
function cellStyle(pct) {
  if (pct === 0 || pct === undefined) return { bg: "bg-white", text: "text-gray-300", label: "—" };
  if (pct <= 70)  return { bg: "bg-emerald-50",  text: "text-emerald-700" };
  if (pct <= 90)  return { bg: "bg-teal-50",     text: "text-teal-700"   };
  if (pct <= 100) return { bg: "bg-yellow-50",   text: "text-yellow-700" };
  if (pct <= 110) return { bg: "bg-orange-50",   text: "text-orange-700" };
  return               { bg: "bg-red-50",        text: "text-red-700"   };
}

// ── OoO helpers ───────────────────────────────────────────────────────────────
function ruid() { return Math.random().toString(36).slice(2, 9); }

// ── Bandwidth bar (card view) ─────────────────────────────────────────────────
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

// ── OoO panel ─────────────────────────────────────────────────────────────────
function OoOPanel({ userId, timeOff, canEdit, onUpdate }) {
  const [adding, setAdding] = useState(false);
  const [form,   setForm]   = useState({ from: "", to: "", note: "" });
  const [saving, setSaving] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const handleAdd = async () => {
    if (!form.from) return;
    setSaving(true);
    const entry = { id: ruid(), from: form.from, to: form.to || form.from, note: form.note.trim() };
    const ref  = doc(db, "users", userId);
    const snap = await getDoc(ref);
    const updated = [...(snap.data()?.timeOff || []), entry].sort((a, b) => a.from.localeCompare(b.from));
    await updateDoc(ref, { timeOff: updated });
    onUpdate(userId, updated);
    setForm({ from: "", to: "", note: "" }); setAdding(false); setSaving(false);
  };
  const handleRemove = async (id) => {
    const ref  = doc(db, "users", userId);
    const snap = await getDoc(ref);
    const updated = (snap.data()?.timeOff || []).filter(e => e.id !== id);
    await updateDoc(ref, { timeOff: updated });
    onUpdate(userId, updated);
  };

  const upcoming = (timeOff || []).filter(e => (e.to || e.from) >= today);
  const past     = (timeOff || []).filter(e => (e.to || e.from) < today);

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">Time Off</span>
        {canEdit && !adding && <button onClick={() => setAdding(true)} className="text-[11px] text-teal-600 hover:text-teal-800">+ Add</button>}
      </div>
      {adding && (
        <div className="bg-slate-50 rounded-md p-2.5 mb-2 space-y-1.5">
          <div className="flex gap-1.5">
            <div className="flex-1">
              <label className="text-[10px] text-gray-400 block mb-0.5">From</label>
              <input type="date" value={form.from} min={today} onChange={e => setForm(p => ({ ...p, from: e.target.value }))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal" />
            </div>
            <div className="flex-1">
              <label className="text-[10px] text-gray-400 block mb-0.5">To</label>
              <input type="date" value={form.to} min={form.from || today} onChange={e => setForm(p => ({ ...p, to: e.target.value }))}
                className="w-full border border-gray-300 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal" />
            </div>
          </div>
          <input placeholder="Note (optional)" value={form.note} onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
            className="w-full border border-gray-300 rounded px-2 py-1 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal" />
          <div className="flex gap-1.5">
            <button onClick={handleAdd} disabled={saving || !form.from} className="flex-1 text-[11px] bg-navy text-white rounded px-2 py-1 disabled:opacity-40">
              {saving ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setAdding(false)} className="text-[11px] text-gray-400 px-2">Cancel</button>
          </div>
        </div>
      )}
      {upcoming.length === 0 && past.length === 0 && !adding && <p className="text-[11px] text-gray-300 italic">No time off logged.</p>}
      {upcoming.map(e => (
        <div key={e.id} className="flex items-center justify-between py-1 group">
          <div>
            <span className="text-[12px] text-gray-700">{fmtRange(e.from, e.to)}</span>
            {e.note && <span className="text-[11px] text-gray-400 ml-1.5">— {e.note}</span>}
          </div>
          {canEdit && <button onClick={() => handleRemove(e.id)} className="text-[10px] text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition">✕</button>}
        </div>
      ))}
      {past.length > 0 && (
        <details className="mt-1">
          <summary className="text-[11px] text-gray-400 cursor-pointer">Past ({past.length})</summary>
          {past.map(e => <div key={e.id} className="text-[11px] text-gray-400 py-0.5 pl-2">{fmtRange(e.from, e.to)} {e.note && `— ${e.note}`}</div>)}
        </details>
      )}
    </div>
  );
}

// ── Card view ─────────────────────────────────────────────────────────────────
function UserCard({ person, tasks, workCalendar, currentUserId, isAdmin }) {
  const [expanded, setExpanded] = useState(false);
  const [timeOff,  setTimeOff]  = useState(person.timeOff || []);
  const canEdit = isAdmin || person.id === currentUserId;
  const bw = computeUserBandwidth(tasks, person.id, workCalendar);
  const band = bw.band;
  const activeTasks = bw.tasks.filter(t => t.status !== "Not Started");
  const initials = person.name?.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
      <div className="flex items-start gap-3 mb-3">
        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-bold text-white shrink-0 ${band.bar}`}>{initials}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-navy truncate">{person.name}</div>
          <div className="text-[11px] text-gray-400 truncate">{person.jobTitle || person.role}</div>
        </div>
        <button onClick={() => setExpanded(!expanded)} className="text-[11px] text-gray-400 hover:text-gray-600 shrink-0">
          {expanded ? "▲ Less" : "▼ More"}
        </button>
      </div>
      <BandwidthBar pct={bw.pct} />
      <div className="flex items-center justify-between text-[11px] text-gray-400 mt-1.5">
        <span>{bw.outstandingHours} outstanding hrs</span>
        <span>{bw.tasks.length} task{bw.tasks.length !== 1 ? "s" : ""}</span>
      </div>
      {expanded && (
        <>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mb-1.5">Active Tasks</div>
            {activeTasks.length === 0 && <p className="text-[11px] text-gray-300 italic">No in-progress tasks.</p>}
            {activeTasks.map(t => (
              <div key={t.id} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                <span className="text-[12px] text-gray-700 truncate flex-1">{t.name}</span>
                <span className="text-[11px] text-gray-400 ml-2 shrink-0">{t.estimatedHours ?? 0}h</span>
              </div>
            ))}
          </div>
          <OoOPanel userId={person.id} timeOff={timeOff} canEdit={canEdit} onUpdate={(_, u) => setTimeOff(u)} />
        </>
      )}
    </div>
  );
}

// ── Allocation grid view ──────────────────────────────────────────────────────
function AllocationGrid({ people, tasks, windowStart, windowEnd }) {
  const days = useMemo(() => getWorkingDaysInRange(windowStart, windowEnd), [windowStart, windowEnd]);

  // Group days by month for the header
  const monthGroups = useMemo(() => {
    const groups = [];
    days.forEach(d => {
      const m = fmtMonth(d);
      if (groups.length === 0 || groups[groups.length - 1].label !== m) {
        groups.push({ label: m, count: 1 });
      } else {
        groups[groups.length - 1].count++;
      }
    });
    return groups;
  }, [days]);

  // Compute daily allocation per person
  const allocations = useMemo(() => {
    const result = {};
    people.forEach(p => {
      result[p.id] = computeDailyAllocation(tasks, p.id, windowStart, windowEnd, 8);
    });
    return result;
  }, [people, tasks, windowStart, windowEnd]);

  // Average allocation per person over the window
  const avgPct = (personId) => {
    const daily = allocations[personId] || {};
    const vals = days.map(d => daily[d]?.pct || 0);
    if (!vals.length) return 0;
    return Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
  };

  const initials = (name) => name?.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) || "?";

  return (
    <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: `${180 + days.length * 60}px` }}>
        <thead>
          {/* Month row */}
          <tr className="bg-slate-50 border-b border-gray-100">
            <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 w-40 border-r border-gray-100" colSpan={2} />
            {monthGroups.map((g, i) => (
              <th key={i} colSpan={g.count} className="px-2 py-2 text-[11px] font-semibold text-gray-500 text-center border-r border-gray-100 last:border-r-0">
                {g.label}
              </th>
            ))}
            <th className="px-3 py-2 text-[11px] font-semibold text-gray-500 text-center border-l border-gray-100">Avg</th>
          </tr>
          {/* Day row */}
          <tr className="bg-slate-50 border-b border-gray-200">
            <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide border-r border-gray-100">Resource</th>
            <th className="px-3 py-2 text-left text-[10px] font-medium text-gray-400 uppercase tracking-wide border-r border-gray-100">Role</th>
            {days.map(d => {
              const { day, dow } = dayLabel(d);
              return (
                <th key={d} className="px-1 py-2 text-center border-r border-gray-100 last:border-r-0 w-14">
                  <div className="text-[10px] text-gray-400">{dow}</div>
                  <div className="text-[11px] font-semibold text-gray-600">{day}</div>
                </th>
              );
            })}
            <th className="px-3 py-2 text-[10px] font-medium text-gray-400 uppercase tracking-wide text-center border-l border-gray-100">Total</th>
          </tr>
        </thead>
        <tbody>
          {people.map((person, idx) => {
            const daily = allocations[person.id] || {};
            const avg   = avgPct(person.id);
            const avgStyle = cellStyle(avg);
            const rowBg = idx % 2 === 0 ? "bg-white" : "bg-slate-50/40";
            return (
              <tr key={person.id} className={`border-b border-gray-50 hover:bg-blue-50/30 transition ${rowBg}`}>
                {/* Resource */}
                <td className="px-3 py-2 border-r border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0 ${getBand(avg).bar}`}>
                      {initials(person.name)}
                    </div>
                    <span className="text-[12px] font-medium text-navy truncate">{person.name}</span>
                  </div>
                </td>
                {/* Role */}
                <td className="px-3 py-2 text-[11px] text-gray-500 border-r border-gray-100 whitespace-nowrap">
                  {person.jobTitle || person.role || "—"}
                </td>
                {/* Daily cells */}
                {days.map(d => {
                  const cell = daily[d];
                  const pct  = cell?.pct || 0;
                  const s    = cellStyle(pct);
                  return (
                    <td key={d} className={`border-r border-gray-100 last:border-r-0 text-center ${s.bg}`}>
                      <span className={`text-[11px] font-medium ${s.text}`}>
                        {pct > 0 ? `${pct}%` : "—"}
                      </span>
                    </td>
                  );
                })}
                {/* Avg */}
                <td className={`px-3 py-2 text-center border-l border-gray-100 ${avgStyle.bg}`}>
                  <span className={`text-[12px] font-bold ${avgStyle.text}`}>{avg > 0 ? `${avg}%` : "—"}</span>
                </td>
              </tr>
            );
          })}
          {people.length === 0 && (
            <tr><td colSpan={days.length + 3} className="px-4 py-8 text-center text-gray-400 text-sm">No team members found.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
const BAND_FILTER_OPTIONS = [
  { value: "all",       label: "All"       },
  { value: "Available", label: "Available" },
  { value: "Healthy",   label: "Healthy"   },
  { value: "Full",      label: "Full"      },
  { value: "At Risk",   label: "At Risk"   },
  { value: "Overloaded",label: "Overloaded"},
];

const RANGE_OPTIONS = [
  { value: 10, label: "2 weeks" },
  { value: 15, label: "3 weeks" },
  { value: 20, label: "4 weeks" },
];

export default function ResourcesPage() {
  const { user, profile } = useAuth();
  const [people,       setPeople]       = useState([]);
  const [tasks,        setTasks]        = useState([]);
  const [workCalendar, setWorkCalendar] = useState({ dailyCapacityHours: 8, workDaysPerWeek: 5 });
  const [bandFilter,   setBandFilter]   = useState("all");
  const [search,       setSearch]       = useState("");
  const [viewMode,     setViewMode]     = useState("grid"); // "grid" | "cards"
  const [rangeSize,    setRangeSize]    = useState(10);     // working days to show
  const [windowStart,  setWindowStart]  = useState(() => startOfWeek(new Date().toISOString().slice(0, 10)));

  const windowEnd = useMemo(() => {
    const days = getWorkingDaysInRange(windowStart, addDays(windowStart, rangeSize * 2));
    return days[rangeSize - 1] || addDays(windowStart, rangeSize);
  }, [windowStart, rangeSize]);

  useEffect(() => {
    const u1 = onSnapshot(collection(db, "users"), snap =>
      setPeople(snap.docs.map(d => ({ id: d.id, ...d.data() }))));
    const u2 = onSnapshot(collectionGroup(db, "tasks"), snap =>
      setTasks(snap.docs.map(d => ({ id: d.id, projectId: d.ref.parent.parent.id, ...d.data() }))));
    getDoc(doc(db, "settings", "workCalendar")).then(snap => {
      if (snap.exists()) setWorkCalendar(snap.data());
    });
    return () => { u1(); u2(); };
  }, []);

  const isAdmin = profile?.role === "Admin";

  const visiblePeople = isAdmin ? people : people.filter(p => p.role !== "Exec Viewer");

  const filtered = visiblePeople.filter(p => {
    if (search && !p.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (bandFilter !== "all") {
      const bw = computeUserBandwidth(tasks, p.id, workCalendar);
      if (bw.band.label !== bandFilter) return false;
    }
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    const ba = computeUserBandwidth(tasks, a.id, workCalendar).pct;
    const bb = computeUserBandwidth(tasks, b.id, workCalendar).pct;
    return bb - ba;
  });

  // Summary cards
  const teamBw      = visiblePeople.map(p => computeUserBandwidth(tasks, p.id, workCalendar));
  const avgPct      = teamBw.length ? Math.round(teamBw.reduce((s, b) => s + b.pct, 0) / teamBw.length) : 0;
  const fullyAvail  = teamBw.filter(b => b.pct <= 70).length;
  const partial     = teamBw.filter(b => b.pct > 70 && b.pct <= 100).length;
  const overAlloc   = teamBw.filter(b => b.pct > 100).length;
  const totalOutstanding = teamBw.reduce((s, b) => s + b.outstandingHours, 0);

  // Date nav
  const goBack = () => setWindowStart(prev => {
    const days = getWorkingDaysInRange(addDays(prev, -rangeSize * 2), prev);
    return days[days.length - rangeSize] || addDays(prev, -rangeSize);
  });
  const goForward = () => setWindowStart(prev => {
    const days = getWorkingDaysInRange(prev, addDays(prev, rangeSize * 2 + 5));
    return days[rangeSize] || addDays(prev, rangeSize);
  });

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-xl font-bold font-heading text-navy mb-0.5">People & Resources</h2>
          <p className="text-[11px] text-gray-400">View resource availability and allocation across projects.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Date nav (grid only) */}
          {viewMode === "grid" && (
            <div className="flex items-center gap-1 border border-gray-200 rounded-md overflow-hidden text-xs bg-white">
              <button onClick={goBack} className="px-2 py-1.5 hover:bg-slate-50 border-r border-gray-200">‹</button>
              <span className="px-3 py-1.5 text-gray-600 whitespace-nowrap font-medium">
                {fmtDate(windowStart)} – {fmtDate(windowEnd)}
              </span>
              <button onClick={goForward} className="px-2 py-1.5 hover:bg-slate-50 border-l border-gray-200">›</button>
            </div>
          )}
          {/* Range selector */}
          {viewMode === "grid" && (
            <select value={rangeSize} onChange={e => setRangeSize(Number(e.target.value))}
              className="border border-gray-200 rounded-md px-2 py-1.5 text-xs bg-white">
              {RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {/* View toggle */}
          <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs font-medium">
            <button onClick={() => setViewMode("grid")}
              className={`px-3 py-1.5 border-r border-gray-200 transition ${viewMode === "grid" ? "bg-navy text-white" : "hover:bg-slate-50 text-gray-600"}`}>
              ⊞ Grid
            </button>
            <button onClick={() => setViewMode("cards")}
              className={`px-3 py-1.5 transition ${viewMode === "cards" ? "bg-navy text-white" : "hover:bg-slate-50 text-gray-600"}`}>
              ▣ Cards
            </button>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="flex gap-3 mb-4 flex-wrap">
        {[
          { label: "Team Members",       value: visiblePeople.length, sub: "active members",                       color: "text-navy"         },
          { label: "Available",          value: fullyAvail,           sub: `${visiblePeople.length ? Math.round(fullyAvail/visiblePeople.length*100) : 0}% of team`,  color: "text-emerald-700", dot: "bg-emerald-400" },
          { label: "Healthy / Full",     value: partial,              sub: `${visiblePeople.length ? Math.round(partial/visiblePeople.length*100) : 0}% of team`,     color: "text-teal-700",    dot: "bg-teal-400"    },
          { label: "Over Allocated",     value: overAlloc,            sub: `${visiblePeople.length ? Math.round(overAlloc/visiblePeople.length*100) : 0}% of team`,   color: "text-red-600",     dot: "bg-red-400",    alert: overAlloc > 0 },
          { label: "Total Outstanding",  value: `${totalOutstanding}h`, sub: "estimated hrs remaining",             color: "text-gray-700"     },
        ].map(({ label, value, sub, color, dot, alert }) => (
          <div key={label} className={`flex-1 min-w-[130px] bg-white rounded-lg border shadow-sm p-3 ${alert ? "border-red-200" : "border-gray-100"}`}>
            <div className="flex items-center gap-1.5 mb-0.5">
              {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
              <span className="text-[11px] text-gray-400">{label}</span>
            </div>
            <div className={`text-2xl font-bold font-heading ${color}`}>{value}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>
          </div>
        ))}

        {/* Legend */}
        <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-3 min-w-[160px]">
          <div className="text-[11px] font-medium text-gray-500 mb-2">Legend</div>
          {[
            { range: "0 – 70%",   label: "Available",    cls: "bg-emerald-400" },
            { range: "71 – 90%",  label: "Healthy",      cls: "bg-teal-400"    },
            { range: "91 – 100%", label: "Full",         cls: "bg-yellow-400"  },
            { range: "101 – 110%",label: "At Risk",      cls: "bg-orange-400"  },
            { range: "111%+",     label: "Overloaded",   cls: "bg-red-400"     },
          ].map(({ range, label, cls }) => (
            <div key={label} className="flex items-center gap-1.5 mb-1">
              <span className={`w-2.5 h-2.5 rounded-sm ${cls}`} />
              <span className="text-[10px] text-gray-500">{range}</span>
              <span className="text-[10px] text-gray-400 ml-auto">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3">
        <input
          placeholder="Search people…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border border-gray-200 rounded-md px-3 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal w-44"
        />
        <select value={bandFilter} onChange={e => setBandFilter(e.target.value)}
          className="border border-gray-200 rounded-md px-2 py-1.5 text-[12px] text-gray-600">
          {BAND_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label === "all" ? "All bandwidth" : o.label}</option>)}
        </select>
      </div>

      {/* Content */}
      {viewMode === "grid" ? (
        <AllocationGrid people={sorted} tasks={tasks} windowStart={windowStart} windowEnd={windowEnd} />
      ) : (
        sorted.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-100 shadow-sm p-8 text-center text-[12px] text-gray-400">
            {visiblePeople.length === 0 ? "No team members found. Add users in User Management." : "No results match your filter."}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-4">
            {sorted.map(person => (
              <UserCard key={person.id} person={person} tasks={tasks} workCalendar={workCalendar}
                currentUserId={user?.uid} isAdmin={isAdmin} />
            ))}
          </div>
        )
      )}

      <p className="text-[10px] text-gray-400 mt-3 text-center">
        Percentages represent daily task hours ÷ 8h capacity. Grid shows working days only.
      </p>
    </div>
  );
}
