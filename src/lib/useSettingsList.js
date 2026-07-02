import { useEffect, useState } from "react";
import { doc, onSnapshot, setDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "./firebase";

// Generic hook for admin-configurable pick-lists stored at settings/{docId}
// as { items: [...] }. Uses onSnapshot so the New Project form always reflects
// the latest values from Admin Settings without needing a page refresh.
export function useSettingsList(docId, defaults) {
  const [items, setItems] = useState([]);
  const ref = doc(db, "settings", docId);

  useEffect(() => {
    const unsub = onSnapshot(
      ref,
      (snap) => {
        if (snap.exists()) {
          const loaded = snap.data().items || [];
          if (loaded.length > 0) {
            setItems([...loaded].sort((a, b) => a.localeCompare(b)));
          } else {
            // Document exists but empty — seed it
            setDoc(ref, { items: defaults }, { merge: true }).catch(console.error);
            setItems([...defaults].sort((a, b) => a.localeCompare(b)));
          }
        } else {
          setDoc(ref, { items: defaults }).catch(console.error);
          setItems([...defaults].sort((a, b) => a.localeCompare(b)));
        }
      },
      (err) => {
        console.error("useSettingsList error", docId, err);
        setItems([...defaults].sort((a, b) => a.localeCompare(b)));
      }
    );
    return unsub;
  }, [docId]);

  const addItem = async (value) => {
    const trimmed = value.trim();
    if (!trimmed || items.includes(trimmed)) return;
    await updateDoc(ref, { items: arrayUnion(trimmed) });
    // onSnapshot will update state automatically
  };

  return [items, addItem];
}
