import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../context/AuthContext";
import SeedTestData from "../components/SeedTestData";
import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove, onSnapshot } from "firebase/firestore";
import { db } from "../../../lib/firebase";

// ── Pick-list manager ──────────────────────────────────────────────────────

const DEFAULTS = {
  trainingTypes:   ["Onboarding", "Compliance & Safety", "Technical & Systems", "Leadership", "Professional Development", "Operational Support", "L&D Improvements"],
  deliveryFormats: ["Face-to-Face ILT", "Virtual ILT", "Blended", "E-Learning"],
  departments:     ["Finance", "Human Resources", "Information Technology", "Learning & Development", "Marketing", "Operations", "Production", "Quality Assurance", "Sales", "Supply Chain", "Warehouse"],
  jobTitles:       ["Content Developer", "Instructional Designer", "L&D Director", "L&D Supervisor", "Trainer"],
};

function useAdminList(docId) {
  const [items, setItems] = useState([]);
  const [ready, setReady] = useState(false);
  const defaults = DEFAULTS[docId] || [];
  const ref = doc(db, "settings", docId);

  useEffect(() => {
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const loaded = snap.data().items || [];
        if (loaded.length > 0) {
          setItems([...loaded].sort((a, b) => a.localeCompare(b)));
        } else {
          setDoc(ref, { items: defaults }, { merge: true }).catch(console.error);
          setItems([...defaults].sort((a, b) => a.localeCompare(b)));
        }
      } else {
        setDoc(ref, { items: defaults }).catch(console.error);
        setItems([...defaults].sort((a, b) => a.localeCompare(b)));
      }
      setReady(true);
    }, (e) => { console.error("useAdminList", docId, e); setItems([...defaults].sort()); setReady(true); });
    return unsub;
  }, [docId]);

  const addItem = async (value) => {
    const trimmed = value.trim();
    if (!trimmed || items.includes(trimmed)) return;
    await updateDoc(ref, { items: arrayUnion(trimmed) }).catch(console.error);
  };
  const removeItem = async (value) => {
    await updateDoc(ref, { items: arrayRemove(value) }).catch(console.error);
  };
  return { items, ready, addItem, removeItem };
}

function SettingsList({ docId, label, description }) {
  const { items, ready, addItem, removeItem } = useAdminList(docId);
  const [newValue, setNewValue] = useState("");
  const [saving, setSaving] = useState(false);

  const handleAdd = async () => {
    if (!newValue.trim()) return;
    setSaving(true);
    await addItem(newValue);
    setNewValue("");
    setSaving(false);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
      <h3 className="text-[13px] font-semibold text-navy font-heading mb-0.5">{label}</h3>
      <p className="text-[11px] text-gray-400 mb-3">{description}</p>
      {!ready ? (
        <p className="text-[12px] text-gray-400 italic py-2">Loading…</p>
      ) : (
        <div className="divide-y divide-gray-50 mb-3">
          {items.map((item) => (
            <div key={item} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-50 group">
              <span className="text-[13px] text-gray-700">{item}</span>
              <button onClick={() => removeItem(item)} className="text-[11px] text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition">Remove</button>
            </div>
          ))}
          {items.length === 0 && <p className="text-[12px] text-gray-400 italic px-2 py-2">No options yet.</p>}
        </div>
      )}
      <div className="flex gap-2">
        <input placeholder="Add new option…" value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-teal" />
        <button onClick={handleAdd} disabled={saving || !newValue.trim()} className="text-[12px] bg-navy text-white px-3 py-1.5 rounded-md disabled:opacity-40">
          {saving ? "…" : "+ Add"}
        </button>
      </div>
    </div>
  );
}

// ── Work Calendar ──────────────────────────────────────────────────────────

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HOLIDAY_TYPES = [
  { value: "regular",   label: "Regular Holiday",        color: "bg-red-100 text-red-700" },
  { value: "special",   label: "Special Non-Working Day", color: "bg-orange-100 text-orange-700" },
  { value: "internal",  label: "Internal Off Day",        color: "bg-blue-100 text-blue-700" },
  { value: "event",     label: "Company Event",           color: "bg-purple-100 text-purple-700" },
];
const holidayTypeMap = Object.fromEntries(HOLIDAY_TYPES.map((t) => [t.value, t]));

const PH_HOLIDAYS_2026 = [
  { date: "2026-01-01", name: "New Year's Day",                    type: "regular" },
  { date: "2026-02-25", name: "EDSA People Power Revolution",      type: "special" },
  { date: "2026-04-02", name: "Maundy Thursday",                   type: "special" },
  { date: "2026-04-03", name: "Good Friday",                       type: "regular" },
  { date: "2026-04-04", name: "Black Saturday",                    type: "special" },
  { date: "2026-04-09", name: "Araw ng Kagitingan",                type: "regular" },
  { date: "2026-05-01", name: "Labor Day",                         type: "regular" },
  { date: "2026-06-12", name: "Independence Day",                  type: "regular" },
  { date: "2026-08-31", name: "National Heroes Day",               type: "regular" },
  { date: "2026-11-01", name: "All Saints' Day",                   type: "special" },
  { date: "2026-11-02", name: "All Souls' Day",                    type: "special" },
  { date: "2026-11-30", name: "Bonifacio Day",                     type: "regular" },
  { date: "2026-12-08", name: "Feast of the Immaculate Conception",type: "special" },
  { date: "2026-12-24", name: "Christmas Eve",                     type: "special" },
  { date: "2026-12-25", name: "Christmas Day",                     type: "regular" },
  { date: "2026-12-30", name: "Rizal Day",                         type: "regular" },
  { date: "2026-12-31", name: "New Year's Eve",                    type: "special" },
];

const CALENDAR_DEFAULT = { dailyCapacityHours: 8, workDays: [1, 2, 3, 4, 5], holidays: PH_HOLIDAYS_2026 };

function WorkCalendarSection() {
  const [calendar, setCalendar] = useState(null);
  const [ready, setReady] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [newHoliday, setNewHoliday] = useState({ date: "", name: "", type: "regular" });
  const [filterType, setFilterType] = useState("all");
  const ref = doc(db, "settings", "workCalendar");

  useEffect(() => {
    const unsub = onSnapshot(ref, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        // Migrate existing holidays that don't have a type field
        const holidays = (data.holidays || []).map((h) => ({ type: "regular", ...h }));
        setCalendar({ ...data, holidays });
      } else {
        setDoc(ref, CALENDAR_DEFAULT).catch(console.error);
        setCalendar(CALENDAR_DEFAULT);
      }
      setReady(true);
    }, (e) => { console.error("workCalendar error", e); setCalendar(CALENDAR_DEFAULT); setReady(true); });
    return unsub;
  }, []);

  const save = async (next) => {
    setCalendar(next);
    setDoc(ref, next).catch(console.error);
  };

  const toggleWorkDay = (day) => {
    const updated = calendar.workDays.includes(day)
      ? calendar.workDays.filter((d) => d !== day)
      : [...calendar.workDays, day].sort();
    save({ ...calendar, workDays: updated });
  };

  const setCapacityHours = async (val) => {
    setSavingHours(true);
    await save({ ...calendar, dailyCapacityHours: Math.min(12, Math.max(1, Number(val))) });
    setSavingHours(false);
  };

  const addHoliday = () => {
    const { date, name, type } = newHoliday;
    if (!date || !name.trim()) return;
    if (calendar.holidays.some((h) => h.date === date)) return;
    const sorted = [...calendar.holidays, { date, name: name.trim(), type }]
      .sort((a, b) => a.date.localeCompare(b.date));
    save({ ...calendar, holidays: sorted });
    setNewHoliday({ date: "", name: "", type: "regular" });
  };

  const removeHoliday = (date) =>
    save({ ...calendar, holidays: calendar.holidays.filter((h) => h.date !== date) });

  if (!ready) return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
      <h3 className="text-[13px] font-semibold text-navy font-heading mb-1">Work Calendar</h3>
      <p className="text-[12px] text-gray-400 italic">Loading…</p>
    </div>
  );

  const weeklyCapacity = (calendar.dailyCapacityHours || 8) * (calendar.workDays?.length || 5);
  const filteredHolidays = filterType === "all"
    ? calendar.holidays
    : calendar.holidays.filter((h) => (h.type || "regular") === filterType);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
      <h3 className="text-[13px] font-semibold text-navy font-heading mb-0.5">Work Calendar</h3>
      <p className="text-[11px] text-gray-400 mb-4">Org-wide capacity baseline for bandwidth calculations.</p>

      <div className="grid grid-cols-2 gap-6">
        {/* Left */}
        <div className="space-y-4">
          <div>
            <label className="text-[11px] text-gray-500 uppercase tracking-wide font-medium mb-2 block">Daily Capacity Hours</label>
            <div className="flex items-center gap-3">
              <input type="number" min="1" max="12" step="0.5"
                defaultValue={calendar.dailyCapacityHours}
                onBlur={(e) => setCapacityHours(e.target.value)}
                className="w-20 border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal" />
              <span className="text-[12px] text-gray-500">hrs/day {savingHours && "saving…"}</span>
            </div>
          </div>
          <div>
            <label className="text-[11px] text-gray-500 uppercase tracking-wide font-medium mb-2 block">Work Days</label>
            <div className="flex gap-1.5">
              {DAY_LABELS.map((d, i) => (
                <button key={i} type="button" onClick={() => toggleWorkDay(i)}
                  className={`w-9 h-9 rounded-full text-[11px] font-medium transition ${calendar.workDays?.includes(i) ? "bg-navy text-white" : "bg-gray-100 text-gray-400 hover:bg-gray-200"}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-teal-50 rounded-md p-3">
            <div className="text-[13px] font-semibold text-teal-800">{weeklyCapacity} hrs / week</div>
            <div className="text-[11px] text-teal-600 mt-0.5">
              {calendar.dailyCapacityHours} hrs × {calendar.workDays?.length} days &nbsp;·&nbsp;
              4-week reference: <strong>{weeklyCapacity * 4} hrs</strong>
            </div>
          </div>
          {/* Legend */}
          <div>
            <div className="text-[11px] text-gray-500 uppercase tracking-wide font-medium mb-1.5">Holiday Categories</div>
            <div className="space-y-1">
              {HOLIDAY_TYPES.map((t) => (
                <div key={t.value} className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${t.color}`}>{t.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: holidays */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[11px] text-gray-500 uppercase tracking-wide font-medium">
              Holidays <span className="font-normal normal-case text-gray-400">({calendar.holidays?.length || 0})</span>
            </label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}
              className="text-[11px] border border-gray-200 rounded px-1.5 py-1 text-gray-500 focus:outline-none">
              <option value="all">All types</option>
              {HOLIDAY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div className="max-h-52 overflow-y-auto divide-y divide-gray-50 mb-3 border border-gray-100 rounded-md">
            {filteredHolidays.map((h) => {
              const ht = holidayTypeMap[h.type || "regular"];
              return (
                <div key={h.date} className="flex items-center justify-between px-2.5 py-1.5 hover:bg-slate-50 group">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`shrink-0 text-[9px] px-1 py-0.5 rounded font-medium ${ht?.color || "bg-gray-100 text-gray-500"}`}>{ht?.label?.split(" ")[0]}</span>
                    <span className="text-[12px] text-gray-700 truncate">{h.name}</span>
                    <span className="text-[11px] text-gray-400 shrink-0">{h.date}</span>
                  </div>
                  <button onClick={() => removeHoliday(h.date)} className="text-[11px] text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition ml-2 shrink-0">✕</button>
                </div>
              );
            })}
            {filteredHolidays.length === 0 && <p className="px-3 py-3 text-[12px] text-gray-400 italic">No entries.</p>}
          </div>

          {/* Add form */}
          <div className="space-y-1.5">
            <div className="flex gap-1.5">
              <input type="date" value={newHoliday.date}
                onChange={(e) => setNewHoliday((p) => ({ ...p, date: e.target.value }))}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal" />
              <select value={newHoliday.type}
                onChange={(e) => setNewHoliday((p) => ({ ...p, type: e.target.value }))}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal">
                {HOLIDAY_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="flex gap-1.5">
              <input placeholder="Name (e.g. Christmas Day)" value={newHoliday.name}
                onChange={(e) => setNewHoliday((p) => ({ ...p, name: e.target.value }))}
                onKeyDown={(e) => e.key === "Enter" && addHoliday()}
                className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:ring-1 focus:ring-teal" />
              <button onClick={addHoliday} className="text-[12px] bg-navy text-white px-3 py-1.5 rounded-md">+ Add</button>
            </div>
          </div>
        </div>
        {/* Dev Tools — for testing only */}
        <div>
          <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Developer Tools</h3>
          <SeedTestData />
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  const { profile } = useAuth();
  const navigate    = useNavigate();

  // Route guard — only Admins can access settings
  useEffect(() => {
    if (profile && profile.role !== "Admin") {
      navigate("/", { replace: true });
    }
  }, [profile, navigate]);

  if (!profile || profile.role !== "Admin") return null;

  return (
    <div>
      <h2 className="text-xl font-bold font-heading text-navy mb-0.5">Admin Settings</h2>
      <p className="text-xs text-gray-500 mb-4">
        Changes apply immediately across the app. Pick-lists are sorted alphabetically. Existing project values are not overwritten.
      </p>
      <div className="space-y-4">
        <WorkCalendarSection />
        <div className="grid grid-cols-4 gap-4">
          <SettingsList docId="trainingTypes"   label="Training Types"        description="Options for Training Type in the New Project form." />
          <SettingsList docId="deliveryFormats" label="Delivery Formats"      description="Options for Delivery Format in the New Project form." />
          <SettingsList docId="departments"     label="Requestor Departments" description="Department options when logging an intake request." />
          <SettingsList docId="jobTitles"       label="Job Titles"            description="Job title options in User Management." />
        </div>
        {/* Dev Tools — for testing only */}
        <div>
          <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wide mb-2">Developer Tools</h3>
          <SeedTestData />
        </div>
      </div>
    </div>
  );
}
