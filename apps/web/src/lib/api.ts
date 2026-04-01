import { createApiClient } from "@nextplay/shared";
import { supabase } from "./supabase";

/**
 * Base URL for `createApiClient` paths like `/boards`, `/tasks`, … (final URLs are `${base}/boards/...`).
 * - Empty → same-origin `/api` (correct for Vercel: handlers live under `/api/*`).
 * - Absolute URL with **no path** (e.g. `https://project.vercel.app`) → append `/api`. A common mistake is
 *   setting only the site origin; that produced `https://…/boards/…` and **404** because static hosting has no `/boards` route.
 * - Already includes a path (e.g. `https://…/api` or `https://…/custom`) → use as-is (trailing slash stripped).
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
    if (path === "" || path === "/") {
      path = "/api";
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
      return session.access_token;
    }

    return refreshed?.access_token ?? session.access_token;
  }

  return session.access_token;
}

export const api = createApiClient(getApiBaseUrl(), getAccessTokenForApi);
