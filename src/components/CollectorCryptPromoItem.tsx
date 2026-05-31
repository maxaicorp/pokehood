import { ExternalLink } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

/** Owner's Collector Crypt referral link — earns a referral credit on signups. */
export const CC_REFERRAL_URL =
  "https://gacha.collectorcrypt.com/referral/5GCtFEBZAKnUiRmRPQBeGFQ35c59RrNoLCK6Fzvp8yCy";

/**
 * Promo row appended to every "Buy Now" dropdown — pitches Collector Crypt
 * (buy/sell graded cards on-chain) via the owner's referral link. Renders a
 * separator + a highlighted item, so it reads as an ad, not just another store.
 * Must be used inside a <DropdownMenuContent>.
 */
export default function CollectorCryptPromoItem() {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild className="p-0 focus:bg-transparent">
        <a
          href={CC_REFERRAL_URL}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="flex items-center gap-2 rounded-sm bg-gradient-to-r from-primary/15 to-purple-500/15 px-2 py-2 hover:from-primary/25 hover:to-purple-500/25 transition-colors"
        >
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-foreground">
              Join Collector Crypt
            </span>
            <span className="text-[11px] text-muted-foreground leading-tight">
              Buy &amp; sell graded cards on-chain
            </span>
          </div>
          <ExternalLink className="w-3.5 h-3.5 opacity-50 ml-auto shrink-0" />
        </a>
      </DropdownMenuItem>
    </>
  );
}
