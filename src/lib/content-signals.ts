import { supabase } from "@/integrations/supabase/client";

export type ContentSignalStatus = "draft" | "approved" | "scheduled" | "posted" | "archived";

export interface MarketingContentSignal {
  id: string;
  signalDate: string;
  signalType: string;
  window: string | null;
  cardId: string | null;
  cardName: string;
  setId: string | null;
  setName: string;
  price: number | null;
  priorPrice: number | null;
  pctChange: number | null;
  totalValue: number | null;
  cardCount: number | null;
  score: number;
  title: string;
  summary: string;
  caption: string;
  templateKey: string;
  targetPath: string;
  imagePayload: Record<string, unknown>;
  status: ContentSignalStatus;
  scheduledAt: string | null;
  postedAt: string | null;
  postedUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

function numOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToSignal(row: Record<string, any>): MarketingContentSignal {
  return {
    id: row.id,
    signalDate: row.signal_date,
    signalType: row.signal_type,
    window: row.window,
    cardId: row.card_id,
    cardName: row.card_name ?? "",
    setId: row.set_id,
    setName: row.set_name ?? "",
    price: numOrNull(row.price),
    priorPrice: numOrNull(row.prior_price),
    pctChange: numOrNull(row.pct_change),
    totalValue: numOrNull(row.total_value),
    cardCount: row.card_count != null ? Number(row.card_count) : null,
    score: Number(row.score ?? 0),
    title: row.title ?? "",
    summary: row.summary ?? "",
    caption: row.caption ?? "",
    templateKey: row.template_key ?? "market_mover",
    targetPath: row.target_path ?? "/",
    imagePayload: (row.image_payload ?? {}) as Record<string, unknown>,
    status: row.status ?? "draft",
    scheduledAt: row.scheduled_at,
    postedAt: row.posted_at,
    postedUrl: row.posted_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listMarketingContentSignals(status?: ContentSignalStatus | "all"): Promise<MarketingContentSignal[]> {
  let query = (supabase.from as any)("marketing_content_signals")
    .select("*")
    .order("signal_date", { ascending: false })
    .order("score", { ascending: false })
    .limit(80);

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as Array<Record<string, any>>).map(rowToSignal);
}

export async function generateMarketingContentSignals(): Promise<number> {
  const { data, error } = await (supabase.functions as any).invoke("generate-content-signals", {
    body: {},
  });
  if (error) throw error;
  return Number(data?.generated ?? 0);
}

export async function updateMarketingContentSignal(
  id: string,
  patch: Partial<Pick<MarketingContentSignal, "status" | "caption" | "scheduledAt" | "postedAt" | "postedUrl">>,
): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (patch.status) payload.status = patch.status;
  if (patch.caption != null) payload.caption = patch.caption;
  if (patch.scheduledAt !== undefined) payload.scheduled_at = patch.scheduledAt;
  if (patch.postedAt !== undefined) payload.posted_at = patch.postedAt;
  if (patch.postedUrl !== undefined) payload.posted_url = patch.postedUrl;
  payload.updated_at = new Date().toISOString();

  const { error } = await (supabase.from as any)("marketing_content_signals")
    .update(payload)
    .eq("id", id);
  if (error) throw error;
}
