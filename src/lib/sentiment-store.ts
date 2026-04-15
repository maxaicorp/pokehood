// Set sentiment voting — per-user up/down votes on sets
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

/** Fetch aggregate sentiment + current user's vote for a list of set IDs */
export async function getSetSentiment(setIds: string[]): Promise<Map<string, SetSentiment>> {
  const map = new Map<string, SetSentiment>();
  if (setIds.length === 0) return map;

  const { data, error } = await (supabase.rpc as any)("get_set_sentiment", {
    p_set_ids: setIds,
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

/** Cast or toggle a vote. Returns the new vote state (null if removed). */
export async function castVote(
  setId: string,
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
      .eq("set_id", setId);
    return null;
  }

  // Upsert the vote
  const { error } = await supabase
    .from("set_sentiment_votes")
    .upsert(
      { user_id: userId, set_id: setId, vote_type: newVote },
      { onConflict: "user_id,set_id" }
    );

  if (error) {
    console.error("Failed to cast vote:", error);
    return currentVote; // return unchanged
  }

  return newVote;
}
