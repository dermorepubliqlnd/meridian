import { useEffect, useState } from "react";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "./firebase";

// Generic hook for admin-configurable pick-lists stored at settings/{docId}
// as { items: [...] }. Seeds with defaults on first read. Used for Job
// Titles, Training Types, Delivery Formats, etc.
export function useSettingsList(docId, defaults) {
  const [items, setItems] = useState([]);
  const ref = doc(db, "settings", docId);

  useEffect(() => {
    const load = async () => {
      const snap = await getDoc(ref);
      if (snap.exists()) {
        setItems(snap.data().items || []);
      } else {
        await setDoc(ref, { items: defaults });
        setItems(defaults);
      }
    };
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const addItem = async (value) => {
    const trimmed = value.trim();
    if (!trimmed || items.includes(trimmed)) return;
    await updateDoc(ref, { items: arrayUnion(trimmed) });
    setItems((prev) => [...prev, trimmed]);
  };

  return [items, addItem];
}
