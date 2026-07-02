import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { db } from "../../../lib/firebase";

// ── Pick-list manager ──────────────────────────────────────────────────────

const DEFAULT_TRAINING_TYPES = [
  "Onboarding", "Compliance & Safety", "Technical & Systems",
  "Leadership", "Professional Development", "Operational Support", "L&D Improvements",
];
const DEFAULT_DELIVERY_FORMATS = ["Face-to-Face ILT", "Virtual ILT", "Blended", "E-Learning"];

function useAdminList(docId, defaults) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const ref = doc(db, "settings", docId);

  const load = async () => {
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const loaded = snap.data().items;
        if (Array.isArray(loaded) && loaded.length > 0) {
          setItems(loaded);
        } else {
          await setDoc(ref, { items: defaults }, { merge: true });
          setItems(defaults);
        }
      } else {
        await setDoc(ref, { items: defaults });
        setItems(defaults);
      }
    } catch (e) {
      console.error("useAdminList load error", docId, e);
      setItems(defaults); // show defaults even if Firestore fails
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [docId]);

  const addItem = async (value) => {
    const trimmed = value.trim();
    if (!trimmed || items.includes(trimmed)) return;
    try {
      await updateDoc(ref, { items: arrayUnion(trimmed) });
      setItems((p) => [...p, trimmed]);
    } catch (e) { console.error("addItem error", e); }
  };
  const removeItem = async (value) => {
    try {
      await updateDoc(ref, { items: arrayRemove(value) });
      setItems((p) => p.filter((i) => i !== value));
    } catch (e) { console.error("removeItem error", e); }
  };
  return { items, loading, addItem, removeItem };
}

function SettingsList({ docId, defaults, label, description }) {
  const { items, loading, addItem, removeItem } = useAdminList(docId, defaults);
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
      {loading ? (
        <p className="text-[12px] text-gray-400 italic py-2">Loading…</p>
      ) : (
        <div className="divide-y divide-gray-50 mb-3">
          {items.map((item) => (
            <div key={item} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-slate-50 group">
              <span className="text-[13px] text-gray-700">{item}</span>
              <button onClick={() => removeItem(item)} className="text-[11px] text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition">
                Remove
              </button>
            </div>
          ))}
          {items.length === 0 && <p className="text-[12px] text-gray-400 italic px-2 py-2">No options yet.</p>}
        </div>
      )}
      <div className="flex gap-2">
        <input
          placeholder="Add new option…"
          value={newValue}
          onChange={(e) => setNewValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-teal"
        />
        <button onClick={handleAdd} disabled={saving || !newValue.trim()} className="text-[12px] bg-navy text-white px-3 py-1.5 rounded-md disabled:opacity-40">
          {saving ? "…" : "+ Add"}
        </button>
      </div>
    </div>
  );
}

// ── Work Calendar ──────────────────────────────────────────────────────────

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const PH_HOLIDAYS_2026 = [
  { date: "2026-01-01", name: "New Year's Day" },
  { date: "2026-02-25", name: "EDSA People Power Revolution" },
  { date: "2026-04-02", name: "Maundy Thursday" },
  { date: "2026-04-03", name: "Good Friday" },
  { date: "2026-04-04", name: "Black Saturday" },
  { date: "2026-04-09", name: "Araw ng Kagitingan" },
  { date: "2026-05-01", name: "Labor Day" },
  { date: "2026-06-12", name: "Independence Day" },
  { date: "2026-08-31", name: "National Heroes Day" },
  { date: "2026-11-01", name: "All Saints' Day" },
  { date: "2026-11-02", name: "All Souls' Day" },
  { date: "2026-11-30", name: "Bonifacio Day" },
  { date: "2026-12-08", name: "Feast of the Immaculate Conception" },
  { date: "2026-12-24", name: "Christmas Eve" },
  { date: "2026-12-25", name: "Christmas Day" },
  { date: "2026-12-30", name: "Rizal Day" },
  { date: "2026-12-31", name: "New Year's Eve" },
];

const CALENDAR_DEFAULT = {
  dailyCapacityHours: 8,
  workDays: [1, 2, 3, 4, 5],
  holidays: PH_HOLIDAYS_2026,
};

function WorkCalendarSection() {
  const [calendar, setCalendar] = useState(null);
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [savingHours, setSavingHours] = useState(false);
  const [newHoliday, setNewHoliday] = useState({ date: "", name: "" });
  const ref = doc(db, "settings", "workCalendar");

  useEffect(() => {
    getDoc(ref).then((snap) => {
      if (snap.exists()) {
        setCalendar(snap.data());
      } else {
        setDoc(ref, CALENDAR_DEFAULT).then(() => setCalendar(CALENDAR_DEFAULT)).catch(() => setCalendar(CALENDAR_DEFAULT));
      }
      setStatus("ready");
    }).catch((e) => {
      console.error("WorkCalendar load error", e);
      setCalendar(CALENDAR_DEFAULT);
      setStatus("ready");
    });
  }, []);

  const save = async (next) => {
    setCalendar(next);
    try { await setDoc(ref, next); } catch (e) { console.error("WorkCalendar save error", e); }
  };

  const toggleWorkDay = (day) => {
    const updated = calendar.workDays.includes(day)
      ? calendar.workDays.filter((d) => d !== day)
      : [...calendar.workDays, day].sort();
    save({ ...calendar, workDays: updated });
  };

  const setCapacityHours = async (val) => {
    const hours = Math.min(12, Math.max(1, Number(val)));
    setSavingHours(true);
    await save({ ...calendar, dailyCapacityHours: hours });
    setSavingHours(false);
  };

  const addHoliday = async () => {
    const { date, name } = newHoliday;
    if (!date || !name.trim()) return;
    if (calendar.holidays.some((h) => h.date === date)) return;
    const sorted = [...calendar.holidays, { date, name: name.trim() }].sort((a, b) => a.date.localeCompare(b.date));
    await save({ ...calendar, holidays: sorted });
    setNewHoliday({ date: "", name: "" });
  };

  const removeHoliday = (date) => save({ ...calendar, holidays: calendar.holidays.filter((h) => h.date !== date) });

  if (status === "loading") return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
      <h3 className="text-[13px] font-semibold text-navy font-heading mb-1">Work Calendar</h3>
      <p className="text-[12px] text-gray-400 italic">Loading…</p>
    </div>
  );

  const weeklyCapacity = (calendar.dailyCapacityHours || 8) * (calendar.workDays?.length || 5);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
      <h3 className="text-[13px] font-semibold text-navy font-heading mb-0.5">Work Calendar</h3>
      <p className="text-[11px] text-gray-400 mb-4">
        Sets the org-wide capacity baseline used for bandwidth calculations in People &amp; Resources.
      </p>

      <div className="grid grid-cols-2 gap-6">
        {/* Left: capacity + work days */}
        <div className="space-y-4">
          <div>
            <label className="text-[11px] text-gray-500 uppercase tracking-wide font-medium mb-2 block">Daily Capacity Hours</label>
            <div className="flex items-center gap-3">
              <input
                type="number" min="1" max="12" step="0.5"
                defaultValue={calendar.dailyCapacityHours}
                onBlur={(e) => setCapacityHours(e.target.value)}
                className="w-20 border border-gray-300 rounded-md px-3 py-1.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-teal"
              />
              <span className="text-[12px] text-gray-500">hrs/day {savingHours && <span className="text-gray-400">saving…</span>}</span>
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

          <div className="bg-teal-50 rounded-md p-3 text-[12px] text-teal-800">
            <div className="font-semibold">{weeklyCapacity} hrs / week</div>
            <div className="text-[11px] text-teal-600 mt-0.5">
              {calendar.dailyCapacityHours} hrs × {calendar.workDays?.length} days &nbsp;·&nbsp;
              4-week reference: <strong>{weeklyCapacity * 4} hrs</strong>
            </div>
          </div>
        </div>

        {/* Right: holidays */}
        <div>
          <label className="text-[11px] text-gray-500 uppercase tracking-wide font-medium mb-2 block">
            Company Holidays <span className="font-normal normal-case text-gray-400">({calendar.holidays?.length || 0})</span>
          </label>
          <div className="max-h-52 overflow-y-auto divide-y divide-gray-50 mb-3 border border-gray-100 rounded-md">
            {(calendar.holidays || []).map((h) => (
              <div key={h.date} className="flex items-center justify-between px-2.5 py-1.5 hover:bg-slate-50 group">
                <div>
                  <span className="text-[12px] text-gray-700">{h.name}</span>
                  <span className="text-[11px] text-gray-400 ml-2">{h.date}</span>
                </div>
                <button onClick={() => removeHoliday(h.date)} className="text-[11px] text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition">✕</button>
              </div>
            ))}
            {!calendar.holidays?.length && <p className="px-3 py-3 text-[12px] text-gray-400 italic">No holidays added.</p>}
          </div>
          <div className="flex gap-2">
            <input type="date" value={newHoliday.date} onChange={(e) => setNewHoliday((p) => ({ ...p, date: e.target.value }))}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-teal" />
            <input placeholder="Holiday name" value={newHoliday.name}
              onChange={(e) => setNewHoliday((p) => ({ ...p, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && addHoliday()}
              className="flex-1 border border-gray-300 rounded-md px-2 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-teal" />
            <button onClick={addHoliday} className="text-[12px] bg-navy text-white px-3 py-1.5 rounded-md">+ Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AdminSettingsPage() {
  return (
    <div>
      <h2 className="text-xl font-bold font-heading text-navy mb-0.5">Admin Settings</h2>
      <p className="text-xs text-gray-500 mb-4">
        Manage org-wide pick-lists and capacity settings. Changes apply immediately. Existing project values are not overwritten.
      </p>

      <div className="space-y-4">
        <WorkCalendarSection />
        <div className="grid grid-cols-2 gap-4">
          <SettingsList docId="trainingTypes" defaults={DEFAULT_TRAINING_TYPES} label="Training Types" description="Options for Training Type when creating a project." />
          <SettingsList docId="deliveryFormats" defaults={DEFAULT_DELIVERY_FORMATS} label="Delivery Formats" description="Options for Delivery Format when creating a project." />
        </div>
      </div>
    </div>
  );
}
