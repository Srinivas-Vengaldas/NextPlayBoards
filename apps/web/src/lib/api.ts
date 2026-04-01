import { createApiClient } from "@nextplay/shared";
import { supabase } from "./supabase";

/** Same-origin `/api` unless `VITE_API_URL` is a non-empty string (trimmed). */
export function getApiBaseUrl(): string {
  const raw = import.meta.env.VITE_API_URL?.replace(/\/$/, "").trim() ?? "";
  return raw.length > 0 ? raw : "/api";
}

export const api = createApiClient(getApiBaseUrl(), async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});
