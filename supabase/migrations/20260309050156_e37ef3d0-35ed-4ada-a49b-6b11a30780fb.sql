
-- Wishlists table
CREATE TABLE public.wishlists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL DEFAULT 'My Wishlist',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.wishlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own wishlists"
ON public.wishlists FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own wishlists"
ON public.wishlists FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own wishlists"
ON public.wishlists FOR UPDATE
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own wishlists"
ON public.wishlists FOR DELETE
USING (auth.uid() = user_id);

CREATE TRIGGER update_wishlists_updated_at
BEFORE UPDATE ON public.wishlists
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Wishlist cards table
CREATE TABLE public.wishlist_cards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  wishlist_id UUID NOT NULL REFERENCES public.wishlists(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  tcg_api_id TEXT NOT NULL,
  name TEXT NOT NULL,
  set_name TEXT NOT NULL,
  set_id TEXT NOT NULL,
  card_number TEXT NOT NULL,
  rarity TEXT NOT NULL DEFAULT 'Unknown',
  image_small TEXT NOT NULL,
  image_large TEXT NOT NULL,
  market_price NUMERIC,
  added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(wishlist_id, tcg_api_id)
);

ALTER TABLE public.wishlist_cards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own wishlist cards"
ON public.wishlist_cards FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can add to their own wishlists"
ON public.wishlist_cards FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove from their own wishlists"
ON public.wishlist_cards FOR DELETE
USING (auth.uid() = user_id);
