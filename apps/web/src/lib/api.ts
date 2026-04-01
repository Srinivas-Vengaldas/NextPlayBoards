import { createApiClient } from "@nextplay/shared";
import { supabase } from "./supabase";

/** Same-origin `/api` unless `VITE_API_URL` is a non-empty string (trimmed). */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL?.replace(/\/$/, "").trim() ?? "";
  return raw.length > 0 ? raw : "/api";
}

/**
 * Returns a usable access token for our Vercel API. Refreshes the session when close to expiry
 * so we don't send an expired JWT (backend would return 401).
 */
async function getAccessTokenForApi(): Promise<string | null> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    console.warn("[api] getSession failed:", sessionError.message);
  }

  if (!session?.access_token) {
    return null;
  }

  const exp = session.expires_at;
  const now = Math.floor(Date.now() / 1000);
  const refreshIfBefore = now + 120;

  if (exp != null && exp <= refreshIfBefore) {
    const {
      data: { session: refreshed },
      error: refreshError,
    } = await supabase.auth.refreshSession();

    if (refreshError) {
      console.warn("[api] refreshSession failed:", refreshError.message);
      return session.access_token;
    }

    return refreshed?.access_token ?? session.access_token;
  }

  return session.access_token;
}

export const api = createApiClient(getApiBaseUrl(), getAccessTokenForApi);
