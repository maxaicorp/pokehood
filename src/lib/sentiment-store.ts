// Card sentiment voting — per-user up/down votes on individual cards
// Aggregates are fetched via a SECURITY DEFINER RPC that hides individual voters.

import { supabase } from "@/integrations/supabase/client";

export type VoteType = "up" | "down";

export interface SetSentiment {
  setId: string;
  upvotes: number;
  downvotes: number;
  score: number;
  currentUserVote: VoteType | null;
}

/** Fetch aggregate sentiment + current user's vote for a list of card IDs */
export async function getSetSentiment(cardIds: string[]): Promise<Map<string, SetSentiment>> {
  const map = new Map<string, SetSentiment>();
  if (cardIds.length === 0) return map;

  const { data, error } = await supabase.rpc("get_set_sentiment", {
    p_set_ids: cardIds,
  });

  if (error || !data) return map;

  for (const row of data as Array<{
    set_id: string;
    upvotes: number;
    downvotes: number;
    score: number;
    current_user_vote: VoteType | null;
  }>) {
    map.set(row.set_id, {
      setId: row.set_id,
      upvotes: row.upvotes,
      downvotes: row.downvotes,
      score: row.score,
      currentUserVote: row.current_user_vote,
    });
  }

  return map;
}

/**
 * Apply a vote toggle to an aggregate, returning the new OPTIMISTIC aggregate.
 * Single source of truth for the up/down arithmetic that was previously
 * hand-inlined as a hard-to-read nested ternary in both Market and CardDetail.
 * Handles every transition: add, toggle-off, and switch (remove the old side
 * AND add the new).
 */
export function applyVote(prev: SetSentiment, voteType: VoteType): SetSentiment {
  const current = prev.currentUserVote;
  const newVote = current === voteType ? null : voteType;
  let upvotes = prev.upvotes;
  let downvotes = prev.downvotes;
  // Remove the previous vote's contribution …
  if (current === "up") upvotes -= 1;
  if (current === "down") downvotes -= 1;
  // … then add the new one (null = toggled off).
  if (newVote === "up") upvotes += 1;
  if (newVote === "down") downvotes += 1;
  upvotes = Math.max(0, upvotes);
  downvotes = Math.max(0, downvotes);
  return { ...prev, upvotes, downvotes, score: upvotes - downvotes, currentUserVote: newVote };
}

/** Cast or toggle a vote. Returns the new vote state (null if removed). */
export async function castVote(
  cardId: string,
  userId: string,
  currentVote: VoteType | null,
  newVote: VoteType
): Promise<VoteType | null> {
  // If clicking the same vote type, remove the vote (toggle off)
  if (currentVote === newVote) {
    await supabase
      .from("set_sentiment_votes")
      .delete()
      .eq("user_id", userId)
      .eq("card_id", cardId);
    return null;
  }

  // Upsert the vote
  const { error } = await supabase
    .from("set_sentiment_votes")
    .upsert(
      { user_id: userId, card_id: cardId, vote_type: newVote },
      { onConflict: "user_id,card_id" }
    );

  if (error) {
    console.error("Failed to cast vote:", error);
    return currentVote; // return unchanged
  }

  return newVote;
}
