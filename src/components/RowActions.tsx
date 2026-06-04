// RowActions — the quick-action surface behind every list-row "+" button.
//
// One Sheet, responsive side: a bottom sheet on mobile (thumb-friendly,
// native-feeling) and a right-side panel on desktop. Same content either way:
// Add to inventory / Add to wishlist (cards only) / Buy (TCGplayer affiliate,
// eBay, Collector Crypt). Replaces the old "+ = add to inventory" assumption
// and surfaces the affiliate buy links on every row.
//
// CONTROLLED: each page keeps one <RowActions> and a "which item was tapped"
// state, so a row's "+" just sets that state (no per-row trigger / event
// plumbing). open = item != null.

import { type ReactNode } from "react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { tcgAffiliateLink } from "@/lib/affiliate";
import { CC_REFERRAL_URL } from "@/components/CollectorCryptPromoItem";
import { PackagePlus, Heart, ExternalLink, ShoppingBag } from "lucide-react";

interface RowActionsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name (sheet header) + basis for the buy search. */
  name: string;
  /** Search string used to deep-link the buy options. */
  buyQuery: string;
  onAddInventory: () => void | Promise<void>;
  /** Omit to hide the wishlist option (e.g. sealed, which has no wishlist yet). */
  onAddWishlist?: () => void | Promise<void>;
}

export default function RowActions({
  open, onOpenChange, name, buyQuery, onAddInventory, onAddWishlist,
}: RowActionsProps) {
  const isMobile = useIsMobile();

  const q = encodeURIComponent(buyQuery);
  const tcg = tcgAffiliateLink(`https://www.tcgplayer.com/search/pokemon/product?q=${q}`);
  const ebay = `https://www.ebay.com/sch/i.html?_nkw=${q}&_sacat=0`;

  // Run the action but LEAVE the panel open — the user can add to inventory and
  // wishlist (and hit a buy link) in one session, then close it manually via the
  // sheet's X. (Was auto-closing after the first tap.)
  const run = async (fn?: () => void | Promise<void>) => {
    await fn?.();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={isMobile ? "rounded-t-2xl" : "w-[340px] sm:max-w-[340px]"}
      >
        <SheetHeader className="text-left">
          <SheetTitle className="truncate pr-6 text-base">{name}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex flex-col gap-1">
          <Row icon={<PackagePlus className="w-[18px] h-[18px]" />} label="Add to inventory"
            onClick={() => run(onAddInventory)} />
          {onAddWishlist && (
            <Row icon={<Heart className="w-[18px] h-[18px]" />} label="Add to wishlist"
              onClick={() => run(onAddWishlist)} />
          )}

          <div className="my-2 flex items-center gap-2 px-3">
            <ShoppingBag className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Buy</span>
            <div className="flex-1 h-px bg-border/60" />
          </div>
          <BuyRow href={tcg} label="TCGplayer" logo="/data/logos/tcgplayer_logo.svg" />
          <BuyRow href={ebay} label="eBay" logo="/data/logos/ebay_logo.svg" />
          <BuyRow href={CC_REFERRAL_URL} label="Collector Crypt" logo="/data/logos/collectorcrypt_logo.svg" sponsored tag="promoted" />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-foreground hover:bg-muted transition-colors"
    >
      {icon}{label}
    </button>
  );
}

function BuyRow({ href, label, logo, sponsored, tag }: { href: string; label: string; logo?: string; sponsored?: boolean; tag?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel={`noopener noreferrer${sponsored ? " sponsored" : ""}`}
      className="flex items-center justify-between gap-3 px-3 py-3 rounded-lg hover:bg-muted transition-colors"
    >
      <span className="flex items-center gap-2 min-w-0">
        {logo ? (
          <img src={logo} alt={label} className="h-5 w-auto max-w-[130px] object-contain" loading="lazy" />
        ) : (
          <span className="truncate text-sm font-medium text-foreground">{label}</span>
        )}
        {tag && <span className="text-[10px] text-muted-foreground">· {tag}</span>}
      </span>
      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    </a>
  );
}
