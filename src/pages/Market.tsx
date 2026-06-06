// ─── MARKET RENDERING CONTRACT ───────────────────────────────────────────────
//
// READ THIS BEFORE EDITING. The same bug has been "fixed" ~100 times because
// well-meaning edits add a caching layer that hides fresh data behind stale
// data. The contract below is the only working version. Changing it WILL
// reintroduce the stale-prices bug.
//
// 1. Data source: get_latest_price_page RPC. That RPC reads from the
//    precomputed latest_card_prices table (NOT from price_snapshots and NOT
//    via live aggregation). Both the table and the RPC live in
//    supabase/migrations/20260519010000_latest_card_prices_table.sql.
//
// 2. Cache strategy: NONE on the browser side. No localStorage. No
//    in-memory shadow that survives across mounts. The DB read is ~30-50ms;
//    a brief skeleton on first paint is correct behavior.
//
// 3. Refresh triggers (any of these re-fetches):
//      a. Component mount / filter change (selectedSetId, refreshToken deps)
//      b. document.visibilitychange  — user returns to the tab
//      c. window 'storage' event with key "collectiblez:force-refresh"
//         (admin Master Refresh broadcasts this)
//      d. Supabase Realtime INSERT/UPDATE on price_snapshots (debounced ~3s)
//
// 4. Errors are LOUD. If the RPC fails, we toast the user. We do NOT silently
//    .catch() and leave stale rows on screen — that hides outages for weeks.
//
// 5. The precomputed table is refreshed by snapshot-prices/index.ts at the
//    end of every successful daily/full/sets/chunk run. If "the site looks
//    stale," check the AdminHealth page first (snapshot ran?) and then the
//    latest_card_prices row count (refresh ran?). Don't add a cache here.
//
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useUrlState } from "@/lib/use-url-state";
import { toastAddedToInventory } from "@/lib/inventory-toast";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import {
  getMarketSets,
  getMarketPrice,
  formatPrice,
  PokemonCard,
  PokemonSet,
  hydrateCardsFromLatestPrices,
  buyQueryForCard,
} from "@/lib/pokemon-api";
import { addToCollection } from "@/lib/collection-store";
import { addCardToDefaultWishlist } from "@/lib/wishlist-store";
import RowActions from "@/components/RowActions";
import { cardPath, cardPathFromApiId } from "@/lib/slug";
import { formatPct, getLatestSnapshotPage, getLatestSnapshotAll, getLatestPricesByIds, getTopMovers } from "@/lib/price-snapshots";
import { recordCollectionAdd, recordWishlistAdd } from "@/lib/card-stats-store";
import { getSetSentiment, castVote, applyVote, type SetSentiment, type VoteType } from "@/lib/sentiment-store";
import AppHeader from "@/components/AppHeader";
import SetSentimentBadge from "@/components/SetSentimentBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, TrendingUp, TrendingDown, ArrowUp, ArrowDown, ArrowUpDown, Flame, Trophy, Eye, Package, Award } from "lucide-react";
import SealedTab from "@/components/SealedTab";
import GradedTab from "@/components/GradedTab";
import { SEALED_TYPES } from "@/lib/sealed-store";
import { getMostViewed, getMostViewedWindowed, CardStatRow } from "@/lib/card-stats-store";
import { toast } from "sonner";
import { motion } from "framer-motion";
import ViewToggle, { type ViewMode } from "@/components/ViewToggle";
import CardGridView from "@/components/CardGridView";
import CardImage from "@/components/CardImage";
import SetLogo from "@/components/SetLogo";
import SEO from "@/components/SEO";

type MarketTab = "top" | "trending" | "most-visited" | "sealed" | "graded";

const VISIBLE_PAGE_SIZE = 10;
// Scroll-load pages are larger than the first paint. The first paint stays at 10
// for fast time-to-content; once the user is scrolling, fetching 25 at a time
// cuts the round-trip count by ~60% over the same scroll distance. The expensive
// part of get_latest_price_page is the per-row LATERAL JOINs for 1d/7d/30d
// prices, so doubling-plus the page size doesn't double the cost.
const SCROLL_PAGE_SIZE = 25;
// Hard cap on how deep multi-set filters scroll before stopping — the tail
// is sub-dollar commons that nobody is browsing for. Cap is per-filter so
// each option gets a budget proportional to its set count.
// Verified 2026-05-18: at modern=500, the 500th card by price is ~$13;
// the 1000th is still ~$4, so 500 leaves plenty of headroom above the
// "should be > $2" rule of thumb if we ever want to bump it.
const RECENT_CAPS: Record<string, number> = { recent5: 750, recent10: 1000, modern: 1000 };
// Default cap for "All Sets" + any single set (single sets have far fewer cards,
// so this just means "load them all"). Raised 500 → 1000 so the All tab goes
// deeper than the ~$200 floor 500 was hitting.
const DEFAULT_CAP = 1000;

// "Modern Era" = Scarlet & Violet onward (S&V + Mega Evolution series).
// Series strings come from the Scrydex `expansion.series` field and must
// match exactly — we use these to build the set ID list at render time so
// new sets in either series get picked up automatically without a code change.
const MODERN_ERA_SERIES = new Set(["Scarlet & Violet", "Mega Evolution"]);

// Market tabs — shared by the desktop tab strip and the mobile dropdown.
const MARKET_TABS = [
  { key: "top", label: "Top", icon: Trophy },
  { key: "sealed", label: "Sealed", icon: Package },
  { key: "graded", label: "Graded", icon: Award },
  { key: "trending", label: "Movers", icon: Flame },
  { key: "most-visited", label: "Most Visited", icon: Eye },
] as const;
type MarketTabKey = (typeof MARKET_TABS)[number]["key"];
const MOST_VISITED_LIMIT = 500;

/** Minimal PokemonCard from a Most-Visited stat row, so the quick-action panel
 *  (add / wishlist / buy) can operate on it like any other card. */
function cardFromStat(s: CardStatRow): PokemonCard {
  const base = s.tcg_api_id.split("::")[0];
  const setId = base.split("-").slice(0, -1).join("-") || base;
  return {
    id: s.tcg_api_id,
    name: s.name,
    supertype: "",
    set: { id: setId, name: s.set_name, series: "", printedTotal: 0, total: 0, releaseDate: "", images: { symbol: "", logo: "" } },
    number: base.split("-").at(-1) ?? "",
    images: { small: s.image_small, large: s.image_small },
  };
}

export default function Market() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // High-traffic toggles are URL-driven (useUrlState) so a click is a
  // deterministic navigation, not a bare setState that could get swallowed
  // mid-render and leave the old view on screen ("button didn't register").
  // Also makes filtered/tabbed views shareable + back-button friendly.
  const [selectedSetId, setSelectedSetId] = useUrlState<string>("set", "modern");
  const [activeTab, setActiveTab] = useUrlState<MarketTab>("tab", "top");
  const [sealedType, setSealedType] = useUrlState<string>("sealedType", "Elite Trainer Box");
  const [viewMode, setViewMode] = useUrlState<ViewMode>("view", "list");
  // Total value + count of the current sealed filter, reported up from SealedTab
  // so the value badge can live in the header next to the dropdown (like Top).
  const [sealedSummary, setSealedSummary] = useState<{ value: number; count: number } | null>(null);
  const [addingCards, setAddingCards] = useState(new Set<string>());
  // Column sort stays local — it's a secondary header click, and the null
  // "unsorted" state doesn't map cleanly to a URL param.
  const [sortCol, setSortCol] = useState<"price" | "24h" | "7d" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [mostVisitedCards, setMostVisitedCards] = useState<CardStatRow[]>([]);
  const [mostVisitedLoading, setMostVisitedLoading] = useState(false);
  const [mvWindow, setMvWindow] = useState<"all" | "24h" | "7d" | "30d">("all");
  const [moversWindow, setMoversWindow] = useState<"24h" | "7d" | "30d">("24h");

  // Sentiment voting state
  const [sentimentMap, setSentimentMap] = useState<Map<string, SetSentiment>>(new Map());
  const isRecentFilter =
    selectedSetId === "recent5" || selectedSetId === "recent10" || selectedSetId === "modern";

  // Always fetch fresh from the DB on mount/focus. No localStorage cache — it was
  // the silent source of "site shows three-week-old prices" complaints. The DB's
  // get_all_latest_prices RPC is already fast (~150ms paginated), so the brief
  // first-paint skeleton is preferable to potentially-stale data.
  const [cards, setCards] = useState<PokemonCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [setsData, setSetsData] = useState<{ data: PokemonSet[] } | null>(null);
  const [pricesReady, setPricesReady] = useState(false);
  // Bumping this re-triggers the data-loading effect — used by window-focus
  // refresh and by the admin Master Refresh broadcast.
  const [refreshToken, setRefreshToken] = useState(0);

  const resolveMarketSetIds = useCallback(() => {
    const physicalSets = (setsData?.data ?? []).filter((s: PokemonSet) => !s.isOnlineOnly);
    if (selectedSetId === "recent5") return new Set(physicalSets.slice(0, 5).map((s) => s.id));
    if (selectedSetId === "recent10") return new Set(physicalSets.slice(0, 10).map((s) => s.id));
    if (selectedSetId === "modern") {
      // Every Scarlet & Violet + Mega Evolution set (promos included — the user
      // wants pull-rate promos in this view since they often have chase cards).
      return new Set(
        physicalSets.filter((s) => MODERN_ERA_SERIES.has(s.series)).map((s) => s.id),
      );
    }
    if (selectedSetId) return new Set([selectedSetId]);
    return new Set(physicalSets.map((s) => s.id));
  }, [selectedSetId, setsData]);

  // Load most visited when tab is active
  useEffect(() => {
    if (activeTab !== "most-visited") return;
    let cancelled = false;
    setMostVisitedLoading(true);
    (mvWindow === "all"
      ? getMostViewed(MOST_VISITED_LIMIT)
      : getMostViewedWindowed(mvWindow, MOST_VISITED_LIMIT))
      .then(async (rows) => {
        // Hydrate with live price + 1d/7d deltas (same data the other tabs show)
        // so Most-Visited isn't a bare view-count list. Targeted by-id fetch.
        try {
          const priceMap = await getLatestPricesByIds(rows.map((r) => r.tcg_api_id));
          rows = rows.map((r) => {
            const p = priceMap.get(r.tcg_api_id);
            return p ? { ...r, price: p.price, price1d: p.price1d, price7d: p.price7d } : r;
          });
        } catch { /* leave rows unpriced — the columns just render "—" */ }
        if (!cancelled) setMostVisitedCards(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("Most Visited fetch failed:", err);
          toast.error("Could not load Most Visited. Pull to refresh or try again.");
          setMostVisitedCards([]);
        }
      })
      .finally(() => {
        if (!cancelled) setMostVisitedLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeTab, refreshToken, mvWindow]);

  // Step 1: Load lightweight set metadata; do not block first paint on the full card index.
  useEffect(() => {
    getMarketSets().then((r) => {
      setSetsData(r);
      setPricesReady(true);
    });
  }, []);

  // Step 2: Load only the first visible price page, then append more pages on scroll.
  useEffect(() => {
    if (!pricesReady || !setsData) return;
    let cancelled = false;
    // Clear the old set's cards immediately so the dropdown change feels like a
    // fresh load instead of "old prices flicker, then jump to new prices."
    // Without this, switching from "Recent 10" to "sv8" leaves sv-unrelated
    // cards on screen for ~200ms while the new fetch runs.
    setCards([]);
    setSentimentMap(new Map());
    setSortCol(null);
    setIsLoading(true);
    setVisibleCount(VISIBLE_PAGE_SIZE);

    const setIds = resolveMarketSetIds();
    // Cap the full load to the same top-N the header summary uses (default 500).
    // This keeps multi-set / "All" filters bounded while still handing the client
    // the COMPLETE filtered set, so column sorts and Trending/Gainers/Losers sort
    // over every card in the filter — not just the rows scrolled into view.
    const cap = RECENT_CAPS[selectedSetId] ?? DEFAULT_CAP;

    // Movers tab: rank the WHOLE catalog (price >= $2) server-side by 24h move,
    // not a client sort over the price-capped top set. Single bounded fetch.
    if (activeTab === "trending") {
      getTopMovers({ window: moversWindow, minPrice: 2, setIds, limit: 250 })
        .then(hydrateCardsFromLatestPrices)
        .then((movers) => { if (!cancelled) { setCards(movers); setIsLoading(false); } })
        .catch((err) => {
          if (!cancelled) {
            setIsLoading(false);
            console.error("Market movers fetch failed:", err);
            toast.error("Could not load movers. Pull to refresh or try again.");
          }
        });
      return () => { cancelled = true; };
    }

    // Phase A — instant first paint with a tiny page so time-to-content stays
    // fast. Phase B then swaps in the full (capped) set for correct sorting.
    getLatestSnapshotPage({ setIds, limit: VISIBLE_PAGE_SIZE, offset: 0 })
      .then(hydrateCardsFromLatestPrices)
      .then((first) => {
        // Don't clobber Phase B if it already landed (it returns the full set).
        if (!cancelled) { setCards((cur) => (cur.length ? cur : first)); setIsLoading(false); }
      })
      .catch((err) => {
        if (!cancelled) {
          setIsLoading(false);
          // Surface failures instead of silently leaving an empty grid on screen.
          // Without this toast, a broken DB query looked identical to "no cards in this set".
          console.error("Market price fetch failed:", err);
          toast.error("Could not load latest prices. Pull to refresh or try again.");
        }
      });

    // Phase B — the full filtered set (capped). Sorting, the mover tabs, and the
    // infinite-scroll reveal all read from this once it lands.
    getLatestSnapshotAll({ setIds, limit: cap })
      .then(hydrateCardsFromLatestPrices)
      .then((all) => { if (!cancelled && all.length) { setCards(all); setIsLoading(false); } })
      .catch(() => { /* Phase A already painted something; leave it on screen */ });

    return () => { cancelled = true; };
  }, [pricesReady, resolveMarketSetIds, selectedSetId, setsData, refreshToken, activeTab, moversWindow]);

  // Refresh on tab focus and on a custom "collectiblez:force-refresh" event
  // (broadcast by the admin Master Refresh button via localStorage). Without
  // this, a user with the tab in the background sees stale prices indefinitely.
  useEffect(() => {
    const bump = () => setRefreshToken((n) => n + 1);
    const onStorage = (e: StorageEvent) => {
      if (e.key === "collectiblez:force-refresh") bump();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Realtime push: when the snapshot-prices cron writes a new row to the
  // price_snapshots table, every open Market tab gets notified within ~1s and
  // re-fetches. This is the "backend updates the frontend immediately" wire —
  // no polling, no cache invalidation, no Master Refresh click needed.
  // Debounced because a single cron run writes thousands of rows in a burst.
  useEffect(() => {
    let pendingBump: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel("price-snapshots-live")
      .on(
        "postgres_changes",
        // "*" not just INSERT: historical repairs (backfill-price-history) and
        // the reprice cron UPDATE existing rows rather than insert new ones, so
        // an INSERT-only listener would miss corrections to past dates.
        { event: "*", schema: "public", table: "price_snapshots" },
        () => {
          if (pendingBump) clearTimeout(pendingBump);
          // Wait 3s of quiet (no more inserts) before refetching — keeps us from
          // hammering the RPC mid-cron-run.
          pendingBump = setTimeout(() => setRefreshToken((n) => n + 1), 3000);
        },
      )
      .subscribe();
    return () => {
      if (pendingBump) clearTimeout(pendingBump);
      supabase.removeChannel(channel);
    };
  }, []);

  // Fetch sentiment for visible cards when filter is recent5/recent10
  useEffect(() => {
    if (!isRecentFilter || cards.length === 0) return;
    const cardIds = cards.map((c) => c.id);
    getSetSentiment(cardIds).then(setSentimentMap);
  }, [isRecentFilter, cards]);

  const handleVote = async (cardId: string, voteType: VoteType) => {
    if (!user) {
      navigate("/auth");
      return;
    }
    const currentVote = sentimentMap.get(cardId)?.currentUserVote ?? null;

    // Optimistic update via the shared helper (single source of vote math).
    setSentimentMap((prev) => {
      const next = new Map(prev);
      const old = prev.get(cardId) || { setId: cardId, upvotes: 0, downvotes: 0, score: 0, currentUserVote: null };
      next.set(cardId, applyVote(old, voteType));
      return next;
    });

    await castVote(cardId, user.id, currentVote, voteType);
  };

  // Infinite scroll observer
  useEffect(() => {
    // Reveal more rows from the already-loaded full set — pure client-side
    // pagination now, no network. The complete filtered set is fetched up front
    // (Phase B in the loader above), so scrolling just uncovers more of the
    // already-sorted list. Slicing clamps, so over-counting is harmless.
    if (isLoading) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && activeTab !== "sealed" && activeTab !== "most-visited" && activeTab !== "graded") {
          setVisibleCount((v) => Math.min(v + SCROLL_PAGE_SIZE, cards.length));
        }
      },
      // Prefetch deep: reveal the next batch when the sentinel is 800px from the
      // viewport so it happens during the scroll, not after hitting the bottom.
      { rootMargin: "800px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, cards.length, isLoading]);

  const handleSort = (col: "price" | "24h" | "7d") => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  // The "+" now opens the quick-action panel (add to inventory / wishlist / buy)
  // instead of adding straight to inventory. The panel binds to this card.
  const [actionCard, setActionCard] = useState<PokemonCard | null>(null);
  const handleAdd = (e: React.MouseEvent, card: PokemonCard) => {
    e.stopPropagation();
    setActionCard(card);
  };

  const addInventory = async (card: PokemonCard) => {
    if (!user) { navigate("/auth"); return; }
    if (addingCards.has(card.id)) return;
    setAddingCards((prev) => new Set(prev).add(card.id));
    const result = await addToCollection(card, user.id);
    setAddingCards((prev) => {
      const next = new Set(prev);
      next.delete(card.id);
      return next;
    });
    if (result) {
      toastAddedToInventory(card.name, navigate);
      recordCollectionAdd({ id: card.id, name: card.name, setName: card.set.name, imageSmall: card.images.small });
      queryClient.invalidateQueries({ queryKey: ["collection"] });
    } else {
      toast.error("Failed to add card.");
    }
  };

  const addWishlist = async (card: PokemonCard) => {
    if (!user) { navigate("/auth"); return; }
    try {
      const ok = await addCardToDefaultWishlist(user.id, card);
      if (ok) {
        toast.success(`Added ${card.name} to wishlist`);
        recordWishlistAdd({ id: card.id, name: card.name, setName: card.set.name, imageSmall: card.images.small });
      } else {
        toast.error("Failed to add to wishlist.");
      }
    } catch {
      toast.error("Failed to add to wishlist.");
    }
  };

  const selectedSet = setsData?.data?.find((s: PokemonSet) => s.id === selectedSetId);

  const getPcts = (card: PokemonCard) => {
    const avgs = card.cardmarketAvgs;
    const trend = avgs?.trend ?? null;
    const raw24h = trend != null && avgs?.avg1 != null && avgs.avg1 !== 0 ? ((trend - avgs.avg1) / avgs.avg1) * 100 : null;
    const raw7d = trend != null && avgs?.avg7 != null && avgs.avg7 !== 0 ? ((trend - avgs.avg7) / avgs.avg7) * 100 : null;
    const raw30d = trend != null && avgs?.avg30 != null && avgs.avg30 !== 0 ? ((trend - avgs.avg30) / avgs.avg30) * 100 : null;
    return { raw24h, raw7d, raw30d };
  };

  const rawPricedCards = (cards || []).filter((c) => getMarketPrice(c) !== null);
  const unpricedCards = (cards || []).filter((c) => getMarketPrice(c) === null);

  // Apply tab-based default sorting, then allow manual column sort to override
  const getTabSortedCards = () => {
    let sorted = [...rawPricedCards];

    if (sortCol) {
      return sorted.sort((a, b) => {
        let va: number | null, vb: number | null;
        if (sortCol === "price") {
          va = getMarketPrice(a);
          vb = getMarketPrice(b);
        } else {
          const pa = getPcts(a);
          const pb = getPcts(b);
          va = sortCol === "24h" ? pa.raw24h : pa.raw7d;
          vb = sortCol === "24h" ? pb.raw24h : pb.raw7d;
        }
        if (va === null && vb === null) return 0;
        if (va === null) return 1;
        if (vb === null) return -1;
        return sortDir === "asc" ? va - vb : vb - va;
      });
    }

    switch (activeTab) {
      case "top":
        return sorted.sort((a, b) => (getMarketPrice(b) ?? 0) - (getMarketPrice(a) ?? 0));
      case "trending":
        // Server already ranked these by |24h move| (get_top_movers, all cards
        // >= $2). Keep a client tiebreak so the order is stable as rows hydrate.
        return sorted
          .filter((c) => getPcts(c).raw24h !== null)
          .sort((a, b) => Math.abs(getPcts(b).raw24h ?? 0) - Math.abs(getPcts(a).raw24h ?? 0));
      default:
        return sorted;
    }
  };

  const pricedCards = getTabSortedCards();
  const visibleCards = pricedCards.slice(0, visibleCount);

  // Multi-set filters: empty (All), recent5/10, and modern. Anything else is
  // a single set ID and gets the compact "Set Total" layout without the Set column.
  const isSingleSet =
    !!selectedSetId && selectedSetId !== "modern" && !selectedSetId.startsWith("recent");

  // Server-computed total for the badge in the header. Replaces the previous
  // client-side reduce over loaded cards, which ratcheted upward as the user
  // scrolled (a "Top 30 Value" that should have read "Top 500 Value"). The
  // new RPC reads the precomputed latest_card_prices table and returns
  // {card_count, total_value} for the filter in one round-trip. The badge
  // stays hidden until this query resolves so the displayed number is final,
  // not an intermediate sum.
  const filterCap = RECENT_CAPS[selectedSetId] ?? DEFAULT_CAP;
  const summarySetIds = (() => {
    if (!setsData) return null;
    if (selectedSetId === "modern") {
      const ids = setsData.data
        .filter((s) => !s.isOnlineOnly && MODERN_ERA_SERIES.has(s.series))
        .map((s) => s.id);
      return ids.length ? ids : null;
    }
    if (selectedSetId === "recent5" || selectedSetId === "recent10") {
      const n = selectedSetId === "recent5" ? 5 : 10;
      const ids = setsData.data.filter((s) => !s.isOnlineOnly).slice(0, n).map((s) => s.id);
      return ids.length ? ids : null;
    }
    return selectedSetId ? [selectedSetId] : null;
  })();
  const { data: summary } = useQuery({
    queryKey: ["market-filter-summary", selectedSetId, filterCap, refreshToken, summarySetIds?.join(",") ?? ""],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("get_filter_summary", {
        p_set_ids: summarySetIds,
        p_top_n: filterCap,
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      return {
        cardCount: Number(row?.card_count ?? 0),
        totalValue: Number(row?.total_value ?? 0),
      };
    },
    enabled: !!setsData,
    staleTime: 5 * 60 * 1000,
  });
  // Round up to whole dollars per user request.
  const totalValue = summary ? Math.ceil(summary.totalValue) : 0;
  const totalCount = summary?.cardCount ?? 0;

  const gridClasses = isSingleSet
    ? "sm:grid-cols-[36px_1fr_108px_88px_88px_40px]"
    : isRecentFilter
      ? "sm:grid-cols-[36px_1fr_248px_108px_88px_88px_104px_40px]"
      : "sm:grid-cols-[36px_1fr_248px_108px_88px_88px_40px]";

  const footerText = (() => {
    if (activeTab === "sealed" || activeTab === "graded") return null;
    if (activeTab === "most-visited") {
      if (mostVisitedLoading || mostVisitedCards.length === 0) return null;
      return `Showing top ${mostVisitedCards.length} most visited cards`;
    }
    if (isLoading) return null;
    if (isSingleSet) return `${pricedCards.length} of ${(cards || []).length} cards have pricing`;
    return pricedCards.length > visibleCards.length
      ? `Showing top ${visibleCards.length} of ${pricedCards.length} cards`
      : `Showing top ${visibleCards.length} cards`;
  })();

  const SortIcon = ({ col }: { col: "price" | "24h" | "7d" }) => {
    if (sortCol !== col) return <ArrowUpDown className="w-3 h-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  // Helper: get sentiment for a card
  const getCardSentiment = (card: PokemonCard): SetSentiment | undefined => {
    if (!isRecentFilter) return undefined;
    return sentimentMap.get(card.id);
  };

  return (
    <div className="min-h-screen bg-background pb-20 sm:pb-0">
      <RowActions
        open={!!actionCard}
        onOpenChange={(o) => { if (!o) setActionCard(null); }}
        name={actionCard?.name ?? ""}
        buyQuery={actionCard ? buyQueryForCard(actionCard) : ""}
        onAddInventory={() => actionCard && addInventory(actionCard)}
        onAddWishlist={() => actionCard && addWishlist(actionCard)}
      />
      <SEO
        title="Pokémon TCG Market Prices & Trends — Collectiblez"
        description="Live market prices, 24h/7d trends, top movers, and sealed product values for every Pokémon TCG expansion."
        path="/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Pokémon TCG Market",
          url: "https://collectiblez.app/market",
          description: "Live market prices and trends for Pokémon TCG cards and sealed products.",
        }}
      />
      <AppHeader activePage="market" />

      <div className="container py-6 px-4 sm:px-8">
        {/* Tabs + Set selector */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 mb-4">
          {/* Mobile: full-width dropdown (6 tabs overflow a phone width). */}
          <div className="w-full sm:hidden">
            <Select
              value={activeTab}
              onValueChange={(v) => { setActiveTab(v as MarketTabKey); setSortCol(null); }}
            >
              <SelectTrigger className="w-full bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MARKET_TABS.map(({ key, label, icon: Icon }) => (
                  <SelectItem key={key} value={key}>
                    <span className="flex items-center gap-2">
                      <Icon className="w-4 h-4" />
                      {label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop: horizontal tab strip. */}
          <div className="hidden sm:flex items-center gap-1 border-b border-border/50 scrollbar-none">
            {MARKET_TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => { setActiveTab(key); setSortCol(null); }}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === key
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>

          {activeTab === "sealed" ? (
            <div className="flex items-center justify-between gap-3">
              {/* Total (left) · controls grouped (right) — no wrap so the row
                  doesn't break apart on mobile. */}
              {sealedSummary && sealedSummary.value > 0 ? (
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground whitespace-nowrap">
                    {sealedSummary.count.toLocaleString()} items
                  </p>
                  <p className="text-lg font-bold text-foreground tabular-nums">
                    ${Math.ceil(sealedSummary.value).toLocaleString("en-US")}
                  </p>
                </div>
              ) : <span />}
              <div className="flex items-center gap-2 shrink-0">
                <Select value={sealedType} onValueChange={setSealedType}>
                  <SelectTrigger className="w-[140px] sm:w-[200px] bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEALED_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ViewToggle value={viewMode} onChange={setViewMode} />
              </div>
            </div>
          ) : activeTab === "most-visited" ? (
            <div className="flex items-center gap-3 justify-between sm:justify-end">
              <Select value={mvWindow} onValueChange={(v) => setMvWindow(v as typeof mvWindow)}>
                <SelectTrigger className="w-[140px] bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="24h">Last 24h</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
              <ViewToggle value={viewMode} onChange={setViewMode} />
            </div>
          ) : activeTab === "graded" ? (
            // Graded tab owns its own company/grade/set filters inside GradedTab.
            <span />
          ) : (
            <div className="flex items-center gap-3 justify-between sm:justify-end">
              {/* Movers timeframe — re-ranks by 24h / 7d / 30d % move. */}
              {activeTab === "trending" && (
                <div className="flex gap-1 shrink-0">
                  {(["24h", "7d", "30d"] as const).map((w) => (
                    <button
                      key={w}
                      onClick={() => setMoversWindow(w)}
                      className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                        moversWindow === w
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              )}
              {/* Hidden until the server-computed total arrives, so the
                  number never ratchets as the user scrolls. Not shown on
                  Movers — a "Top N value" sum is meaningless on a movers list
                  (it's ranked by % move, not value). */}
              {activeTab !== "trending" && summary && totalValue > 0 && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground whitespace-nowrap">
                    {isSingleSet ? "Set Total" : `Top ${totalCount}`}
                  </p>
                  <p className="text-lg font-bold text-foreground tabular-nums">
                    ${totalValue.toLocaleString("en-US")}
                  </p>
                </div>
              )}
              <Select
                value={selectedSetId || "all"}
                onValueChange={(v) => setSelectedSetId(v === "all" ? "" : v)}
              >
                <SelectTrigger className="w-[160px] min-[380px]:w-[180px] sm:w-[200px] bg-background">
                  <SelectValue placeholder="All Sets" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sets</SelectItem>
                  <SelectItem value="modern">Modern Era</SelectItem>
                  <SelectItem value="recent5">Recent Sets (5)</SelectItem>
                  <SelectItem value="recent10">Recent Sets (10)</SelectItem>
                  {setsData?.data
                    ?.filter((s: PokemonSet) => !s.isOnlineOnly)
                    .map((s: PokemonSet) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ViewToggle value={viewMode} onChange={setViewMode} />
            </div>
          )}
        </div>

        {/* Table */}
        <div className="rounded-xl border border-border overflow-hidden">
          {/* Table header — hidden when Sealed/Graded/Most Visited tab is active or grid mode */}
          {activeTab !== "sealed" && activeTab !== "most-visited" && activeTab !== "graded" && viewMode === "list" && (
            <div className={`hidden sm:grid ${gridClasses} gap-3 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground items-center`}>
              <span>#</span>
              <span>Card</span>
              {!isSingleSet && <span>Set</span>}
              <button onClick={() => handleSort("price")} className="flex items-center justify-end gap-1 whitespace-nowrap hover:text-foreground transition-colors">
                Price <SortIcon col="price" />
              </button>
              <button onClick={() => handleSort("24h")} className="flex items-center justify-end gap-1 whitespace-nowrap hover:text-foreground transition-colors">
                24h % <SortIcon col="24h" />
              </button>
              <button onClick={() => handleSort("7d")} className="flex items-center justify-end gap-1 whitespace-nowrap hover:text-foreground transition-colors">
                7d % <SortIcon col="7d" />
              </button>
              {isRecentFilter && <span className="text-right">Vote</span>}
              <span />
            </div>
          )}

          {activeTab === "sealed" ? (
            <SealedTab typeFilter={sealedType} viewMode={viewMode} onSummary={(value, count) => setSealedSummary({ value, count })} />
          ) : activeTab === "graded" ? (
            <GradedTab />
          ) : activeTab === "most-visited" ? (
            mostVisitedLoading ? (
              <div>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0">
                    <Skeleton className="h-4 w-6 shrink-0" />
                    <Skeleton className="w-10 h-14 rounded-md shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-28" />
                    </div>
                    <Skeleton className="h-5 w-16 ml-auto" />
                  </div>
                ))}
              </div>
            ) : mostVisitedCards.length === 0 ? (
              <div className="py-16 text-center text-muted-foreground">
                No visit data yet. Browse some cards to populate this list!
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 p-3">
                {mostVisitedCards.map((stat, i) => (
                  <motion.div
                    key={stat.tcg_api_id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    className="group relative bg-card border border-border/50 hover:border-primary/40 cursor-pointer transition-all hover:shadow-lg hover:shadow-primary/5"
                    onClick={() => navigate(cardPathFromApiId(stat.tcg_api_id, stat.name, stat.set_name))}
                  >
                    <div className="aspect-[5/7] relative bg-muted">
                      {stat.image_small ? (
                        <CardImage src={stat.image_small} alt={stat.name} className="w-full h-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Eye className="w-8 h-8 text-muted-foreground/30" />
                        </div>
                      )}
                      <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-background/90 backdrop-blur-sm border border-border/50 flex items-center gap-1">
                        <Eye className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs font-bold text-foreground tabular-nums">{stat.view_count}</span>
                      </div>
                    </div>
                    <div className="p-2">
                      <p className="text-xs font-semibold text-foreground truncate">{stat.name}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{stat.set_name}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div>
                {/* Header row — matches the other data tables' top bar.
                    Same grid template as the rows below so columns line up. */}
                <div className="hidden sm:grid grid-cols-[36px_1fr_248px_108px_88px_88px_64px_40px] gap-3 px-4 py-2.5 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground items-center">
                  <span>#</span>
                  <span>Card</span>
                  <span>Set</span>
                  <span className="text-right">Price</span>
                  <span className="text-right">24h %</span>
                  <span className="text-right">7d %</span>
                  <span className="text-right">Views</span>
                  <span />
                </div>
                {mostVisitedCards.map((stat, i) => {
                  const d1 = stat.price != null && stat.price1d != null && stat.price1d !== 0
                    ? ((stat.price - stat.price1d) / stat.price1d) * 100 : null;
                  const d7 = stat.price != null && stat.price7d != null && stat.price7d !== 0
                    ? ((stat.price - stat.price7d) / stat.price7d) * 100 : null;
                  const p1 = formatPct(d1), p7 = formatPct(d7);
                  return (
                    <motion.div
                      key={stat.tcg_api_id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: Math.min(i * 0.01, 0.3) }}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => navigate(cardPathFromApiId(stat.tcg_api_id, stat.name, stat.set_name))}
                    >
                      {/* Desktop grid — same column widths as the other Market tables */}
                      <div className="hidden sm:grid grid-cols-[36px_1fr_248px_108px_88px_88px_64px_40px] gap-3 px-4 py-2.5 items-center">
                        <span className="text-sm font-mono text-muted-foreground tabular-nums">{i + 1}</span>
                        <div className="flex items-center gap-3 min-w-0">
                          {stat.image_small && (
                            <CardImage src={stat.image_small} alt={stat.name} className="w-10 shrink-0 shadow-sm" loading="lazy" />
                          )}
                          <p className="text-sm font-semibold text-foreground truncate">{stat.name}</p>
                        </div>
                        <div className="flex items-center gap-2 min-w-0">
                          <SetLogo cardId={stat.tcg_api_id} alt="" className="h-5 w-auto max-w-[64px] object-contain shrink-0" />
                          <p className="text-sm text-muted-foreground truncate">{stat.set_name}</p>
                        </div>
                        <p className="text-sm font-bold text-foreground text-right tabular-nums">{stat.price != null ? formatPrice(stat.price) : "—"}</p>
                        <p className={`text-xs font-medium text-right tabular-nums ${p1.className}`}>{p1.text}</p>
                        <p className={`text-xs font-medium text-right tabular-nums ${p7.className}`}>{p7.text}</p>
                        <div className="flex items-center justify-end gap-1">
                          <Eye className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-semibold text-foreground tabular-nums">{stat.view_count}</span>
                        </div>
                        <Button
                          size="icon" variant="ghost" aria-label="Card actions"
                          className="h-7 w-7 rounded-full border border-border/50 hover:border-primary hover:text-primary shrink-0 justify-self-center"
                          onClick={(e) => { e.stopPropagation(); setActionCard(cardFromStat(stat)); }}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>

                      {/* Mobile card — matches the Top tab layout */}
                      <div className="sm:hidden p-4">
                        <div className="flex gap-3">
                          <div className="relative shrink-0">
                            <span className="absolute -top-1.5 -left-1.5 z-10 text-[10px] font-mono font-semibold text-foreground bg-background/95 backdrop-blur px-1.5 py-0.5 rounded-full border border-border/60 tabular-nums shadow-sm">{i + 1}</span>
                            {stat.image_small ? (
                              <CardImage src={stat.image_small} alt={stat.name} className="w-20 aspect-[5/7] shadow-md object-contain bg-muted" loading="lazy" />
                            ) : (
                              <div className="w-20 aspect-[5/7] rounded bg-muted flex items-center justify-center"><Eye className="w-6 h-6 text-muted-foreground/40" /></div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <p className="text-base font-semibold text-foreground leading-tight truncate">{stat.name}</p>
                                <p className="text-xs text-muted-foreground truncate mt-0.5">{stat.set_name}</p>
                              </div>
                              <p className="text-base font-bold text-foreground tabular-nums shrink-0">{stat.price != null ? formatPrice(stat.price) : "—"}</p>
                            </div>
                            <div className="flex items-center gap-4 text-[11px] mt-2">
                              <div className="flex items-center gap-1"><span className="text-muted-foreground">24h</span><span className={`font-medium tabular-nums ${p1.className}`}>{p1.text}</span></div>
                              <div className="flex items-center gap-1"><span className="text-muted-foreground">7d</span><span className={`font-medium tabular-nums ${p7.className}`}>{p7.text}</span></div>
                            </div>
                            <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-border/30">
                              <div className="flex items-center gap-1.5 text-xs">
                                <Eye className="w-4 h-4 text-muted-foreground" />
                                <span className="font-semibold tabular-nums text-foreground">{stat.view_count}</span>
                                <span className="text-muted-foreground">views</span>
                              </div>
                              <Button
                                size="icon" variant="ghost" aria-label="Card actions"
                                className="h-8 w-8 p-0 rounded-full border border-border/50 hover:border-primary hover:text-primary"
                                onClick={(e) => { e.stopPropagation(); setActionCard(cardFromStat(stat)); }}
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )
          ) : isLoading && cards.length === 0 ? (
            <div>
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3 border-b border-border/50 last:border-0"
                >
                  <Skeleton className="h-4 w-6 shrink-0" />
                  <Skeleton className="w-10 h-14 rounded-md shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-28" />
                  </div>
                  <Skeleton className="h-5 w-16 ml-auto" />
                </div>
              ))}
            </div>
          ) : pricedCards.length === 0 && !isLoading ? (
            <div className="py-16 text-center text-muted-foreground">
              No pricing data available right now.
            </div>
          ) : viewMode === "grid" ? (
            <div>
              <CardGridView
                cards={visibleCards}
                getPcts={getPcts}
                onAdd={handleAdd}
                addingCards={addingCards}
                sentimentMap={isRecentFilter ? sentimentMap : undefined}
                onVote={handleVote}
              />
              <div ref={sentinelRef} className="h-1" />
            </div>
          ) : (
            <div>
              {visibleCards.map((card, i) => {
                const price = getMarketPrice(card);
                const { raw24h, raw7d } = getPcts(card);
                const pct24h = formatPct(raw24h);
                const pct7d = formatPct(raw7d);
                const sentiment = getCardSentiment(card);
                return (
                  <motion.div
                    key={card.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.008, 0.3) }}
                    className="border-b border-border/50 last:border-0 hover:bg-muted/30 cursor-pointer transition-colors"
                    onClick={() => navigate(cardPath(card.set, card))}
                  >
                    {/* Desktop: grid row */}
                    <div className={`hidden sm:grid ${gridClasses} gap-3 px-4 py-2.5 items-center`}>
                      <span className="text-sm font-mono text-muted-foreground tabular-nums">{i + 1}</span>
                      <div className="flex items-center gap-3 min-w-0">
                        <CardImage src={card.images.small} alt={card.name} className="w-10 shrink-0 shadow-sm" loading="lazy" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{card.name}</p>
                          <p className="text-[10px] text-muted-foreground/60 truncate">#{card.number}/{card.set.printedTotal || card.set.total}</p>
                        </div>
                      </div>
                      {!isSingleSet && (
                        <div className="flex items-center gap-2 min-w-0">
                          <SetLogo setId={card.set.id} fallbackUrl={card.set.images?.logo} alt="" className="h-5 w-auto max-w-[64px] object-contain shrink-0" />
                          <p className="text-sm text-muted-foreground truncate">{card.set.name}</p>
                        </div>
                      )}
                      <p className="text-sm font-bold text-foreground text-right tabular-nums">{formatPrice(price)}</p>
                      <p className={`text-xs font-medium text-right tabular-nums ${pct24h.className}`}>{pct24h.text}</p>
                      <p className={`text-xs font-medium text-right tabular-nums ${pct7d.className}`}>{pct7d.text}</p>
                      {isRecentFilter && (
                        <div className="flex justify-end">
                          <SetSentimentBadge
                            upvotes={sentiment?.upvotes ?? 0}
                            downvotes={sentiment?.downvotes ?? 0}
                            score={sentiment?.score ?? 0}
                            currentUserVote={sentiment?.currentUserVote ?? null}
                            onVote={(vt) => handleVote(card.id, vt)}
                            compact
                          />
                        </div>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 rounded-full border border-border/50 hover:border-primary hover:text-primary shrink-0"
                        disabled={addingCards.has(card.id)}
                        onClick={(e) => handleAdd(e, card)}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </Button>
                    </div>

                    {/* Mobile: real card layout (Option A — 2026-05-19).
                        Bigger portrait image, info stacked vertically with
                        breathing room, vote + add on their own action row
                        with proper touch targets. No more cramming everything
                        onto one line. Strictly mobile — desktop grid above
                        is untouched. */}
                    <div className="sm:hidden p-4">
                      <div className="flex gap-3">
                        {/* Card image with rank pill in the corner */}
                        <div className="relative shrink-0">
                          <span className="absolute -top-1.5 -left-1.5 z-10 text-[10px] font-mono font-semibold text-foreground bg-background/95 backdrop-blur px-1.5 py-0.5 rounded-full border border-border/60 tabular-nums shadow-sm">
                            {i + 1}
                          </span>
                          <CardImage
                            src={card.images.small}
                            alt={card.name}
                            className="w-20 aspect-[5/7] shadow-md object-contain bg-muted"
                            loading="lazy"
                          />
                        </div>

                        {/* Details column */}
                        <div className="flex-1 min-w-0 flex flex-col">
                          {/* Title + price */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-base font-semibold text-foreground leading-tight truncate">{card.name}</p>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">{card.set.name}</p>
                              <p className="text-[11px] text-muted-foreground/60 mt-0.5 tabular-nums">
                                #{card.number}/{card.set.printedTotal || card.set.total}
                              </p>
                            </div>
                            <p className="text-base font-bold text-foreground tabular-nums shrink-0">
                              {formatPrice(price)}
                            </p>
                          </div>

                          {/* Stat chips — 24h and 7d each as a labeled pair */}
                          <div className="flex items-center gap-4 text-[11px] mt-2">
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">24h</span>
                              <span className={`font-medium tabular-nums ${pct24h.className}`}>{pct24h.text}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-muted-foreground">7d</span>
                              <span className={`font-medium tabular-nums ${pct7d.className}`}>{pct7d.text}</span>
                            </div>
                          </div>

                          {/* Action row — vote chips + add button. Bigger
                              touch targets than the old icon-only layout. */}
                          <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-border/30">
                            {isRecentFilter ? (
                              <SetSentimentBadge
                                upvotes={sentiment?.upvotes ?? 0}
                                downvotes={sentiment?.downvotes ?? 0}
                                score={sentiment?.score ?? 0}
                                currentUserVote={sentiment?.currentUserVote ?? null}
                                onVote={(vt) => handleVote(card.id, vt)}
                                compact
                              />
                            ) : (
                              <span aria-hidden />
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              aria-label="Card actions"
                              className="h-8 w-8 p-0 rounded-full border border-border/50 hover:border-primary hover:text-primary"
                              onClick={(e) => handleAdd(e, card)}
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}

              {/* Unpriced cards in set view */}
              {isSingleSet && unpricedCards.length > 0 && (
                <>
                  <div className="px-4 py-2 bg-muted/30 border-t border-border text-xs text-muted-foreground">
                    {unpricedCards.length} card{unpricedCards.length !== 1 ? "s" : ""} with no pricing data
                  </div>
                  {unpricedCards.map((card, i) => (
                    <motion.div
                      key={card.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: Math.min(i * 0.005, 0.2) }}
                      className={`grid grid-cols-[24px_1fr_auto] ${gridClasses} gap-2 sm:gap-4 px-3 sm:px-4 py-2.5 border-b border-border/50 last:border-0 items-center hover:bg-muted/30 cursor-pointer transition-colors opacity-50`}
                      onClick={() => navigate(cardPath(card.set, card))}
                    >
                      <span className="text-sm font-mono text-muted-foreground">—</span>
                      <div className="flex items-center gap-3 min-w-0">
                        <CardImage src={card.images.small} alt={card.name} className="w-9 sm:w-10 shrink-0 shadow-sm" loading="lazy" />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{card.name}</p>
                          <p className="text-[10px] text-muted-foreground/60 truncate">#{card.number}/{card.set.printedTotal || card.set.total}</p>
                        </div>
                      </div>
                      {!isSingleSet && <p className="hidden sm:block text-sm text-muted-foreground truncate">{card.set.name}</p>}
                      <p className="hidden sm:block text-sm text-muted-foreground text-right">N/A</p>
                      <p className="hidden sm:block text-xs text-muted-foreground text-right">—</p>
                      <p className="hidden sm:block text-xs text-muted-foreground text-right">—</p>
                      <div className="flex items-center justify-end gap-2">
                        <span className="text-sm text-muted-foreground sm:hidden">N/A</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 rounded-full border border-border/50 hover:border-primary hover:text-primary shrink-0"
                          disabled={addingCards.has(card.id)}
                          onClick={(e) => handleAdd(e, card)}
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </motion.div>
                  ))}
                </>
              )}
              {/* Sentinel for infinite scroll */}
              <div ref={sentinelRef} className="h-1" />
              {isLoading && cards.length > 0 && (
                <div className="flex items-center justify-center py-4 gap-2 text-sm text-muted-foreground">
                  <span className="w-4 h-4 animate-spin border-2 border-primary border-t-transparent rounded-full" />
                  Loading more cards…
                </div>
              )}
            </div>
          )}
        </div>

        {footerText && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            {footerText}
          </p>
        )}
      </div>
    </div>
  );
}
