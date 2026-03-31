import { createApiClient } from "@nextplay/shared";
import { supabase } from "./supabase";

const baseUrl = import.meta.env.VITE_API_URL?.replace(/\/$/, "") ?? "";

export const api = createApiClient(baseUrl, async () => {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
});
