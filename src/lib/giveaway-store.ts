// Giveaway data layer — read-side helpers, plus admin write helpers and the
// submit/confirm function invocations.

import { supabase } from "@/integrations/supabase/client";

export interface Giveaway {
  id: string;
  title: string;
  description: string | null;
  prize_image_url: string | null;
  estimated_value_usd: number | null;
  starts_at: string;
  ends_at: string;
  status: "draft" | "active" | "closed" | "drawn";
  winner_entry_id: string | null;
  rules_text: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface GiveawayEntry {
  id: string;
  giveaway_id: string;
  user_id: string | null;
  full_name: string;
  email: string;
  street_address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  status: "pending" | "confirmed" | "rejected";
  confirmation_token: string;
  confirmation_sent_at: string | null;
  confirmed_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface SubmitPayload {
  giveaway_id: string;
  full_name: string;
  email: string;
  street_address: string;
  city: string;
  state: string;
  zip: string;
}

// ─── Public reads ────────────────────────────────────────────────────────────

export async function getActiveGiveaway(): Promise<Giveaway | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await (supabase.from as any)("giveaways")
    .select("*")
    .eq("status", "active")
    .lte("starts_at", nowIso)
    .gt("ends_at", nowIso)
    .order("ends_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("getActiveGiveaway:", error);
    return null;
  }
  return (data as Giveaway) ?? null;
}

// ─── Public writes (via edge functions) ──────────────────────────────────────

export async function submitGiveawayEntry(payload: SubmitPayload): Promise<{
  ok: boolean;
  email_sent?: boolean;
  message?: string;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("giveaway-submit", {
    body: payload,
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? "Unknown error" };
  return { ok: true, email_sent: data.email_sent, message: data.message };
}

export async function confirmGiveawayEntry(token: string): Promise<{
  ok: boolean;
  already_confirmed?: boolean;
  full_name?: string;
  error?: string;
}> {
  const { data, error } = await supabase.functions.invoke("giveaway-confirm", {
    body: { token },
  });
  if (error) return { ok: false, error: error.message };
  if (!data?.ok) return { ok: false, error: data?.error ?? "Unknown error" };
  return {
    ok: true,
    already_confirmed: data.already_confirmed,
    full_name: data.full_name,
  };
}

// ─── Admin reads/writes ──────────────────────────────────────────────────────

export async function listGiveaways(): Promise<Giveaway[]> {
  const { data, error } = await (supabase.from as any)("giveaways")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("listGiveaways:", error);
    return [];
  }
  return (data ?? []) as Giveaway[];
}

export async function getGiveaway(id: string): Promise<Giveaway | null> {
  const { data, error } = await (supabase.from as any)("giveaways")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getGiveaway:", error);
    return null;
  }
  return (data as Giveaway) ?? null;
}

export async function createGiveaway(payload: Partial<Giveaway>): Promise<Giveaway | null> {
  const userRes = await supabase.auth.getUser();
  const userId = userRes.data.user?.id;
  if (!userId) throw new Error("Must be signed in");

  const insertPayload = { ...payload, created_by: userId };
  const { data, error } = await (supabase.from as any)("giveaways")
    .insert(insertPayload)
    .select()
    .single();
  if (error) {
    console.error("createGiveaway:", error);
    throw error;
  }
  return data as Giveaway;
}

export async function updateGiveaway(id: string, patch: Partial<Giveaway>): Promise<void> {
  const { error } = await (supabase.from as any)("giveaways").update(patch).eq("id", id);
  if (error) {
    console.error("updateGiveaway:", error);
    throw error;
  }
}

export async function deleteGiveaway(id: string): Promise<void> {
  const { error } = await (supabase.from as any)("giveaways").delete().eq("id", id);
  if (error) {
    console.error("deleteGiveaway:", error);
    throw error;
  }
}

export async function listEntries(giveawayId: string): Promise<GiveawayEntry[]> {
  const { data, error } = await (supabase.from as any)("giveaway_entries")
    .select("*")
    .eq("giveaway_id", giveawayId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("listEntries:", error);
    return [];
  }
  return (data ?? []) as GiveawayEntry[];
}

export async function updateEntryStatus(
  id: string,
  status: GiveawayEntry["status"],
): Promise<void> {
  const patch: Partial<GiveawayEntry> = { status };
  if (status === "confirmed") patch.confirmed_at = new Date().toISOString();
  const { error } = await (supabase.from as any)("giveaway_entries").update(patch).eq("id", id);
  if (error) {
    console.error("updateEntryStatus:", error);
    throw error;
  }
}

// ─── Storage: prize image upload ─────────────────────────────────────────────

export async function uploadGiveawayImage(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `prize/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("giveaway-images").upload(path, file, {
    cacheControl: "3600",
    contentType: file.type || "image/png",
    upsert: false,
  });
  if (error) {
    console.error("uploadGiveawayImage:", error);
    throw error;
  }
  const { data } = supabase.storage.from("giveaway-images").getPublicUrl(path);
  return data.publicUrl;
}

// ─── Pick a winner ───────────────────────────────────────────────────────────

export async function drawWinner(giveawayId: string): Promise<GiveawayEntry | null> {
  // Idempotent: if the giveaway is already drawn, return the existing winner
  // instead of re-rolling. Two simultaneous admin clicks return the same row.
  const giveaway = await getGiveaway(giveawayId);
  if (!giveaway) throw new Error("Giveaway not found");
  if (giveaway.status === "drawn" && giveaway.winner_entry_id) {
    const entries = await listEntries(giveawayId);
    return entries.find((e) => e.id === giveaway.winner_entry_id) ?? null;
  }

  const entries = await listEntries(giveawayId);
  const eligible = entries.filter((e) => e.status === "confirmed");
  if (eligible.length === 0) return null;
  const winner = eligible[Math.floor(Math.random() * eligible.length)];
  await updateGiveaway(giveawayId, { status: "drawn", winner_entry_id: winner.id });
  return winner;
}
