import { useAuth } from "@/context/AuthContext";
import { useState } from "react";
import { Navigate } from "react-router-dom";

export default function LoginPage() {
  const { user, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) {
    return <Navigate to="/" replace />;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const fn = mode === "signin" ? signIn : signUp;
      const { error: err } = await fn(email, password);
      if (err) {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-4">
      <div className="w-full max-w-md rounded-2xl border border-blue-100 bg-white p-8 shadow-card">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-blue-900">NextPlay</h1>
          <p className="mt-1 text-sm text-blue-600">
            Sign in to manage your boards
          </p>
        </div>
        <div className="mb-6 flex rounded-lg bg-blue-50 p-1">
          <button
            type="button"
            className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
              mode === "signin"
                ? "bg-white text-blue-900 shadow"
                : "text-blue-600"
            }`}
            onClick={() => setMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={`flex-1 rounded-md py-2 text-sm font-medium transition ${
              mode === "signup"
                ? "bg-white text-blue-900 shadow"
                : "text-blue-600"
            }`}
            onClick={() => setMode("signup")}
          >
            Create account
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-blue-700">
              Email
            </label>
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-900 outline-none ring-accent focus:border-transparent focus:ring-2"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-blue-700">
              Password
            </label>
            <input
              type="password"
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm text-blue-900 outline-none ring-accent focus:border-transparent focus:ring-2"
            />
          </div>
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-accent py-2.5 text-sm font-semibold text-accent-foreground shadow-sm transition hover:opacity-95 disabled:opacity-50"
          >
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
