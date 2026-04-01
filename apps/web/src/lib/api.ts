import { createApiClient } from "@nextplay/shared";
import { supabase } from "./supabase";

/**
 * Base URL for `createApiClient` paths like `/boards`, `/tasks`, … (final URLs are `${base}/boards/...`).
 * - Empty → same-origin `/api` (Vercel serverless lives under `/api/*`).
 * - Absolute URL with no path (only origin) → append `/api`. Mis-set `VITE_API_URL=https://app.vercel.app`
 *   used to produce `https://app.vercel.app/boards/...` → **404** (no `/boards` on the static host).
 * - In the **browser**, if env is exactly this page’s origin with no path, return relative `/api` so it
 *   self-heals even when an old build inlined the wrong env (lazy resolver + `createApiClient(() => …)`).
 */
export function getApiBaseUrl(): string {
  const raw = (import.meta.env.VITE_API_URL ?? "").trim();
  if (!raw) return "/api";

  const noTrailingSlash = raw.replace(/\/+$/, "");

  if (noTrailingSlash.startsWith("/")) {
    return noTrailingSlash || "/api";
  }

  try {
    const u = new URL(noTrailingSlash);
    let path = u.pathname.replace(/\/+$/, "") || "";

    const pageOrigin =
      typeof globalThis !== "undefined" && "location" in globalThis
        ? (globalThis as unknown as { location?: { origin?: string } }).location?.origin
        : undefined;

    if (path === "" || path === "/") {
      if (pageOrigin && u.origin === pageOrigin) {
        return "/api";
      }
      return `${u.origin}/api`;
    }
    return `${u.origin}${path}`;
  } catch {
    return "/api";
  }
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
      // When the refresh token is revoked/rotated (or from another Supabase project),
      // Supabase returns 400 "Invalid Refresh Token". Keeping the old access token causes
      // repeated API failures; sign out to force a clean login.
      if (/invalid refresh token/i.test(refreshError.message)) {
        try {
          await supabase.auth.signOut();
        } catch (e) {
          console.warn("[api] signOut after invalid refresh token failed:", String(e));
        }
        return null;
      }
      return session.access_token;
    }

    return refreshed?.access_token ?? session.access_token;
  }

  return session.access_token;
}

export const api = createApiClient(() => getApiBaseUrl(), getAccessTokenForApi);
