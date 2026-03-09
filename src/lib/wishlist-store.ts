import { supabase } from "@/integrations/supabase/client";

export interface Wishlist {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  cardCount?: number;
}

export interface WishlistCard {
  id: string;
  wishlistId: string;
  userId: string;
  tcgApiId: string;
  name: string;
  setName: string;
  setId: string;
  cardNumber: string;
  rarity: string;
  imageSmall: string;
  imageLarge: string;
  marketPrice: number | null;
  addedAt: string;
}

function mapWishlist(row: any): Wishlist {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWishlistCard(row: any): WishlistCard {
  return {
    id: row.id,
    wishlistId: row.wishlist_id,
    userId: row.user_id,
    tcgApiId: row.tcg_api_id,
    name: row.name,
    setName: row.set_name,
    setId: row.set_id,
    cardNumber: row.card_number,
    rarity: row.rarity,
    imageSmall: row.image_small,
    imageLarge: row.image_large,
    marketPrice: row.market_price,
    addedAt: row.added_at,
  };
}

export async function getWishlists(): Promise<Wishlist[]> {
  const { data, error } = await supabase
    .from("wishlists")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []).map(mapWishlist);
}

export async function createWishlist(userId: string, name: string = "My Wishlist"): Promise<Wishlist> {
  const { data, error } = await supabase
    .from("wishlists")
    .insert({ user_id: userId, name })
    .select()
    .single();
  if (error) throw error;
  return mapWishlist(data);
}

export async function deleteWishlist(id: string): Promise<void> {
  const { error } = await supabase.from("wishlists").delete().eq("id", id);
  if (error) throw error;
}

export async function renameWishlist(id: string, name: string): Promise<void> {
  const { error } = await supabase.from("wishlists").update({ name }).eq("id", id);
  if (error) throw error;
}

export async function getWishlistCards(wishlistId: string): Promise<WishlistCard[]> {
  const { data, error } = await supabase
    .from("wishlist_cards")
    .select("*")
    .eq("wishlist_id", wishlistId)
    .order("added_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(mapWishlistCard);
}

export async function addCardToWishlist(
  wishlistId: string,
  userId: string,
  card: {
    id: string;
    name: string;
    set: { name: string; id: string };
    number: string;
    rarity?: string;
    images: { small: string; large: string };
    cardmarket?: { prices?: { averageSellPrice?: number } };
    tcgplayer?: { prices?: Record<string, { market?: number }> };
  }
): Promise<boolean> {
  const marketPrice =
    card.tcgplayer?.prices
      ? Math.max(...Object.values(card.tcgplayer.prices).map((p) => p.market ?? 0))
      : card.cardmarket?.prices?.averageSellPrice ?? null;

  const { error } = await supabase.from("wishlist_cards").insert({
    wishlist_id: wishlistId,
    user_id: userId,
    tcg_api_id: card.id,
    name: card.name,
    set_name: card.set.name,
    set_id: card.set.id,
    card_number: card.number,
    rarity: card.rarity || "Unknown",
    image_small: card.images.small,
    image_large: card.images.large,
    market_price: marketPrice,
  });
  if (error) {
    if (error.code === "23505") return false; // duplicate
    throw error;
  }
  return true;
}

export async function removeCardFromWishlist(cardId: string): Promise<void> {
  const { error } = await supabase.from("wishlist_cards").delete().eq("id", cardId);
  if (error) throw error;
}

export async function getWishlistCardCount(wishlistId: string): Promise<number> {
  const { count, error } = await supabase
    .from("wishlist_cards")
    .select("*", { count: "exact", head: true })
    .eq("wishlist_id", wishlistId);
  if (error) throw error;
  return count || 0;
}

export async function getAllWishlistCardIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("wishlist_cards")
    .select("tcg_api_id")
    .eq("user_id", userId);
  if (error) throw error;
  return new Set((data || []).map((r: any) => r.tcg_api_id));
}
