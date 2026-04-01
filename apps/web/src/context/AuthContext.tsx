import type { AuthChangeEvent, Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const ANON_SIGNIN_422_HELP =
  "Anonymous sign-in was rejected (HTTP 422). In the Supabase Dashboard, open Authentication → Sign In / Providers, enable Anonymous sign-ins, save, then confirm this app uses the same Project URL and anon (public) key as that project.";

function messageForAnonSignInError(error: { status?: number; message: string }): string {
  const status = typeof error.status === "number" ? error.status : undefined;
  if (status === 422 || /\b422\b/.test(error.message)) {
    return ANON_SIGNIN_422_HELP;
  }
  return error.message?.trim() ? error.message : "Anonymous sign-in failed.";
}

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  /** Set when anonymous bootstrap or post–sign-out anon session fails (e.g. Supabase 422). */
  anonymousAuthError: string | null;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [anonymousAuthError, setAnonymousAuthError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }: { data: { session: Session | null } }) => {
      if (data.session) {
        setSession(data.session);
        setAnonymousAuthError(null);
        setLoading(false);
        return;
      }
      setAnonymousAuthError(null);
      const { data: anon, error: anonError } = await supabase.auth.signInAnonymously();
      if (anonError) {
        setSession(null);
        setAnonymousAuthError(messageForAnonSignInError(anonError));
        setLoading(false);
        return;
      }
      setSession(anon.session ?? null);
      setAnonymousAuthError(null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: AuthChangeEvent, s: Session | null) => {
        setSession(s);
        if (s) {
          setAnonymousAuthError(null);
        }
      },
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  const value: AuthState = {
    session,
    user: session?.user ?? null,
    loading,
    anonymousAuthError,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error as Error | null };
    },
    signUp: async (email, password) => {
      const { error } = await supabase.auth.signUp({ email, password });
      return { error: error as Error | null };
    },
    signOut: async () => {
      await supabase.auth.signOut();
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        setSession(null);
        setAnonymousAuthError(messageForAnonSignInError(error));
        return;
      }
      setSession(data.session ?? null);
      setAnonymousAuthError(null);
    },
  };

  return (
    <>
      {anonymousAuthError ? (
        <div
          role="alert"
          style={{
            background: "#450a0a",
            color: "#fecaca",
            padding: "0.75rem 1rem",
            fontSize: "0.875rem",
            lineHeight: 1.45,
            borderBottom: "1px solid #7f1d1d",
          }}
        >
          <strong style={{ display: "block", marginBottom: "0.35rem" }}>Authentication</strong>
          {anonymousAuthError}
        </div>
      ) : null}
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </>
  );
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) {
    throw new Error("useAuth needs AuthProvider");
  }
  return v;
}
