// Firebase initialization for Meridian
import { initializeApp, getApps, deleteApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyCHfNZyz9kn-Rb3XgwnxmaC9Tdx-3HqPtU",
  authDomain: "meridian-1caa9.firebaseapp.com",
  projectId: "meridian-1caa9",
  storageBucket: "meridian-1caa9.firebasestorage.app",
  messagingSenderId: "293133715914",
  appId: "1:293133715914:web:a7c0b2e96a68f03ba7a733",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export default app;

/**
 * Creates a new Firebase Auth user WITHOUT signing the current admin out.
 * Trick: spin up a temporary secondary Firebase app instance, create the
 * user there, then tear it down. The admin's session on the main `auth`
 * instance is untouched.
 */
export async function createUserWithoutSignIn(email, password) {
  const secondaryName = `secondary-${Date.now()}`;
  const secondaryApp = initializeApp(firebaseConfig, secondaryName);
  const secondaryAuth = getAuth(secondaryApp);
  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    return cred.user.uid;
  } finally {
    await deleteApp(secondaryApp);
  }
}
