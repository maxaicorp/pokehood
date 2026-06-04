import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";

/** Owner's Collector Crypt referral link — earns a referral credit on signups. */
export const CC_REFERRAL_URL =
  "https://gacha.collectorcrypt.com/referral/5GCtFEBZAKnUiRmRPQBeGFQ35c59RrNoLCK6Fzvp8yCy";

/**
 * Promo row appended to every "Buy Now" dropdown — pitches Collector Crypt via
 * the owner's referral link. A thin rainbow-gradient button (so it reads as a
 * promoted placement, not just another store) with a "* promoted" disclaimer.
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
          className="flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-sm font-semibold text-white shadow-sm bg-[linear-gradient(90deg,#f43f5e,#f59e0b,#22c55e,#3b82f6,#a855f7)] bg-[length:200%_100%] hover:bg-[position:100%_0] transition-all duration-500"
          style={{ textShadow: "0 1px 2px rgba(0,0,0,0.3)" }}
        >
          <span>Try Collector Crypt</span>
          <span className="text-[10px] font-medium opacity-90 whitespace-nowrap">* promoted</span>
        </a>
      </DropdownMenuItem>
    </>
  );
}
