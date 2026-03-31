import { createApiClient } from "@nextplay/shared";
import { supabase } from "./supabase";

const base = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");

export const api = createApiClient(base, async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});
