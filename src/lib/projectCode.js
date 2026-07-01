import { doc, runTransaction } from "firebase/firestore";
import { db } from "./firebase";

// Generates sequential project codes like LND-2026-001, scoped per year.
export async function generateProjectCode() {
  const year = new Date().getFullYear();
  const counterRef = doc(db, "settings", `projectCounter-${year}`);

  const nextNumber = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? snap.data().count : 0;
    const next = current + 1;
    tx.set(counterRef, { count: next, year });
    return next;
  });

  return `LND-${year}-${String(nextNumber).padStart(3, "0")}`;
}
