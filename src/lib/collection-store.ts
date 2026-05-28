import { supabase } from "@/integrations/supabase/client";
import { PokemonCard, getMarketPrice, enrichCardWithPricing } from "./pokemon-api";
import type { SealedProduct } from "./sealed-store";
import { getSealedMarketPrice } from "./sealed-store";

export interface CollectionCard {
  id: string;
  tcgApiId: string;
  name: string;
  setName: string;
  setId: string;
  cardNumber: string;
  rarity: string;
  condition: string;
  quantity: number;
  manualPrice: number | null;
  imageSmall: string;
  imageLarge: string;
  marketPrice: number | null;
  addedAt: string;
  forSale: boolean;
  salePrice: number | null;
  // 'card' (single) or 'sealed' (booster box, ETB, etc.). Sealed rows have
  // no meaningful condition and render differently in the collection view.
  productType: "card" | "sealed";
}

/** Map DB row → app type */
function rowToCard(row: any): CollectionCard {
  return {
    id: row.id,
    tcgApiId: row.tcg_api_id,
    name: row.name,
    setName: row.set_name,
    setId: row.set_id,
    cardNumber: row.card_number,
    rarity: row.rarity,
    condition: row.condition,
    quantity: row.quantity,
    manualPrice: row.manual_price,
    imageSmall: row.image_small,
    imageLarge: row.image_large,
    marketPrice: row.market_price,
    addedAt: row.added_at,
    forSale: row.for_sale,
    salePrice: row.sale_price,
    productType: row.product_type ?? "card",
  };
}

/** Fetch the authenticated user's collection */
export async function getCollection(): Promise<CollectionCard[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("collection_cards")
    .select("*")
    .eq("user_id", user.id)
    .order("added_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch collection:", error);
    return [];
  }
  return (data || []).map(rowToCard);
}

/** Fetch a collection for a specific user (public profile view) */
export async function getCollectionByUserId(userId: string): Promise<CollectionCard[]> {
  const { data, error } = await supabase
    .from("collection_cards")
    .select("*")
    .eq("user_id", userId)
    .order("added_at", { ascending: false });

  if (error) {
    console.error("Failed to fetch user collection:", error);
    return [];
  }
  return (data || []).map(rowToCard);
}

/** Add a card (or increment quantity if same card + condition exists) */
export async function addToCollection(
  card: PokemonCard,
  userId: string,
  condition = "NM",
  quantity = 1
): Promise<CollectionCard | null> {
  // Enrich card with live pricing before storing
  card = await enrichCardWithPricing(card);

  const { data: existing, error: lookupError } = await supabase
    .from("collection_cards")
    .select("*")
    .eq("user_id", userId)
    .eq("tcg_api_id", card.id)
    .eq("condition", condition)
    .maybeSingle();

  // If lookup errored (e.g. multiple rows exist due to prior race condition),
  // bail out rather than inserting another duplicate.
  if (lookupError) {
    console.error("Failed to check existing card:", lookupError);
    return null;
  }

  if (existing) {
    const { data, error } = await supabase
      .from("collection_cards")
      .update({ quantity: existing.quantity + quantity })
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      console.error("Failed to update card quantity:", error);
      return null;
    }
    return rowToCard(data);
  }

  const { data, error } = await supabase
    .from("collection_cards")
    .insert({
      user_id: userId,
      tcg_api_id: card.id,
      name: card.name,
      set_name: card.set.name,
      set_id: card.set.id,
      card_number: card.number,
      rarity: card.rarity || "Unknown",
      condition,
      quantity,
      manual_price: null,
      market_price: getMarketPrice(card),
      image_small: card.images.small,
      image_large: card.images.large,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to add card:", error);
    return null;
  }
  return rowToCard(data);
}

/** Add a sealed product (or increment quantity if already owned). Mirrors
 *  addToCollection but stores product_type='sealed' and skips condition
 *  (sealed products are, by definition, sealed). */
export async function addSealedToCollection(
  product: SealedProduct,
  userId: string,
  quantity = 1,
): Promise<CollectionCard | null> {
  const { data: existing, error: lookupError } = await supabase
    .from("collection_cards")
    .select("*")
    .eq("user_id", userId)
    .eq("tcg_api_id", product.id)
    .eq("product_type", "sealed")
    .maybeSingle();

  if (lookupError) {
    console.error("Failed to check existing sealed product:", lookupError);
    return null;
  }

  if (existing) {
    const { data, error } = await supabase
      .from("collection_cards")
      .update({ quantity: existing.quantity + quantity })
      .eq("id", existing.id)
      .select()
      .single();
    if (error) {
      console.error("Failed to update sealed quantity:", error);
      return null;
    }
    return rowToCard(data);
  }

  const { data, error } = await supabase
    .from("collection_cards")
    .insert({
      user_id: userId,
      tcg_api_id: product.id,
      name: product.name,
      set_name: product.expansionName,
      set_id: product.expansionId,
      card_number: "",                 // sealed products have no card number
      rarity: product.type || "Sealed",
      condition: "SEALED",             // sentinel; UI hides the condition picker
      quantity,
      manual_price: null,
      market_price: getSealedMarketPrice(product),
      image_small: product.imageSmall,
      image_large: product.imageMedium ?? product.imageSmall,
      product_type: "sealed",
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to add sealed product:", error);
    return null;
  }
  return rowToCard(data);
}

/** Remove a card by id */
export async function removeFromCollection(id: string): Promise<boolean> {
  const { error } = await supabase
    .from("collection_cards")
    .delete()
    .eq("id", id);

  if (error) {
    console.error("Failed to remove card:", error);
    return false;
  }
  return true;
}

/** Update card quantity */
export async function updateCardQuantity(id: string, quantity: number): Promise<boolean> {
  const { error } = await supabase
    .from("collection_cards")
    .update({ quantity })
    .eq("id", id);

  if (error) {
    console.error("Failed to update quantity:", error);
    return false;
  }
  return true;
}

/** Update card condition */
export async function updateCardCondition(id: string, condition: string): Promise<boolean> {
  const { error } = await supabase
    .from("collection_cards")
    .update({ condition })
    .eq("id", id);

  if (error) {
    console.error("Failed to update condition:", error);
    return false;
  }
  return true;
}

/** Toggle for-sale status */
export async function toggleForSale(id: string, forSale: boolean, salePrice?: number): Promise<boolean> {
  const { error } = await supabase
    .from("collection_cards")
    .update({ for_sale: forSale, sale_price: salePrice ?? null })
    .eq("id", id);

  if (error) {
    console.error("Failed to toggle for sale:", error);
    return false;
  }
  return true;
}

/** Check if a slug is available */
export async function checkSlugAvailability(slug: string, currentUserId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("user_id")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Failed to check slug:", error);
    return false;
  }
  // Available if no one has it, or the current user already owns it
  return !data || data.user_id === currentUserId;
}

export function getTotalValue(collection: CollectionCard[]): number {
  return collection.reduce((sum, card) => {
    const price = card.manualPrice ?? card.marketPrice ?? 0;
    return sum + price * card.quantity;
  }, 0);
}

export function getCollectionBySet(collection: CollectionCard[]): Record<string, CollectionCard[]> {
  return collection.reduce((acc, card) => {
    if (!acc[card.setName]) acc[card.setName] = [];
    acc[card.setName].push(card);
    return acc;
  }, {} as Record<string, CollectionCard[]>);
}
