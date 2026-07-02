import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  OAuthProvider,
} from "firebase/auth";
import { auth } from "../lib/firebase";
import GlobeMark from "../components/GlobeMark";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [resetSent, setResetSent] = useState(false);
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

  const handleForgotPassword = async () => {
    if (!email) {
      setError("Enter your email address above first.");
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      setResetSent(true);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  };

  const handleMicrosoftLogin = async () => {
    setError("");
    try {
      const provider = new OAuthProvider("microsoft.com");
      await signInWithPopup(auth, provider);
      navigate("/");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-navy">
      <div className="bg-white rounded-xl shadow-lg p-8 w-full max-w-sm">
        <div className="flex items-center gap-3 mb-1">
          <GlobeMark size={36} />
          <h1 className="text-xl font-bold font-heading text-navy">Meridian</h1>
        </div>
        <p className="text-sm text-teal-700 font-medium mb-4">True north.</p>

        <form onSubmit={handleEmailLogin} className="space-y-4">
          <input
            id="email"
            name="email"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
            required
          />
          <div className="relative">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-2 pr-10 text-sm focus:outline-none focus:ring-2 focus:ring-teal"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs"
              tabIndex={-1}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          {error && <p className="text-red-500 text-xs">{error}</p>}
          {resetSent && <p className="text-green-600 text-xs">Password reset email sent — check your inbox.</p>}

          <button
            type="submit"
            className="w-full bg-navy text-white rounded-md py-2 text-sm font-medium hover:bg-navy-light transition"
          >
            Sign in
          </button>
        </form>

        <div className="text-center mt-2">
          <button
            type="button"
            onClick={handleForgotPassword}
            className="text-xs text-teal-600 hover:underline"
          >
            Forgot password?
          </button>
        </div>

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
