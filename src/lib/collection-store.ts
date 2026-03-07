import { PokemonCard, getMarketPrice } from "./pokemon-api";

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
}

const STORAGE_KEY = "pokevault_collection";

export function getCollection(): CollectionCard[] {
  const data = localStorage.getItem(STORAGE_KEY);
  return data ? JSON.parse(data) : [];
}

export function addToCollection(card: PokemonCard, condition = "NM", quantity = 1): CollectionCard {
  const collection = getCollection();
  const existing = collection.find(c => c.tcgApiId === card.id && c.condition === condition);

  if (existing) {
    existing.quantity += quantity;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
    return existing;
  }

  const newCard: CollectionCard = {
    id: crypto.randomUUID(),
    tcgApiId: card.id,
    name: card.name,
    setName: card.set.name,
    setId: card.set.id,
    cardNumber: card.number,
    rarity: card.rarity || "Unknown",
    condition,
    quantity,
    manualPrice: null,
    imageSmall: card.images.small,
    imageLarge: card.images.large,
    marketPrice: getMarketPrice(card),
    addedAt: new Date().toISOString(),
  };

  collection.push(newCard);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
  return newCard;
}

export function removeFromCollection(id: string) {
  const collection = getCollection().filter(c => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
}

export function updateCardQuantity(id: string, quantity: number) {
  const collection = getCollection();
  const card = collection.find(c => c.id === id);
  if (card) {
    card.quantity = quantity;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(collection));
  }
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
