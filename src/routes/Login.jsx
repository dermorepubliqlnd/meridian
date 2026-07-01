import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  OAuthProvider,
} from "firebase/auth";
import { auth } from "../lib/firebase";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMicrosoftLogin = async () => {
    setError("");
    try {
      const provider = new OAuthProvider("microsoft.com");
      // provider.setCustomParameters({ tenant: "YOUR_TENANT_ID" }); // set once Azure AD app is registered
      await signInWithPopup(auth, provider);
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-navy mb-1">Meridian</h1>
        <p className="text-sm text-gray-500 mb-6">L&D Project Management</p>

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            required
          />
          {error && <p className="text-red-500 text-xs">{error}</p>}
          <button
            type="submit"
            className="w-full bg-navy text-white rounded-md py-2 text-sm font-medium hover:bg-navy-light transition"
          >
            Sign in
          </button>
        </form>

        <div className="my-4 flex items-center gap-2">
          <div className="h-px bg-gray-200 flex-1" />
          <span className="text-xs text-gray-400">or</span>
          <div className="h-px bg-gray-200 flex-1" />
        </div>

        <button
          onClick={handleMicrosoftLogin}
          className="w-full border border-gray-300 rounded-md py-2 text-sm font-medium flex items-center justify-center gap-2 hover:bg-gray-50 transition"
        >
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}
