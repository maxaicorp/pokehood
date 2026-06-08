import { describe, expect, it } from "vitest";
import { getScrydexNmAuditFromCard, type ScrydexCard } from "./scrydex-api";

function cardWithVariants(variants: ScrydexCard["variants"]): ScrydexCard {
  return {
    id: "me4-116",
    name: "Mega Greninja ex",
    supertype: "Pokemon",
    number: "116",
    images: [],
    expansion: {
      id: "me4",
      name: "Chaos Rising",
      series: "Mega Evolution",
      code: "ME4",
      total: 122,
      language_code: "EN",
      release_date: "2026/05/22",
      is_online_only: false,
    },
    variants,
    language_code: "EN",
  } as ScrydexCard;
}

describe("getScrydexNmAuditFromCard", () => {
  it("accepts a holofoil raw NM USD price", () => {
    const audit = getScrydexNmAuditFromCard(
      cardWithVariants([
        { name: "holofoil", prices: [
          {
            condition: "NM",
            is_perfect: false,
            is_signed: false,
            is_error: false,
            type: "raw",
            low: 329.33,
            market: 372.71,
            currency: "USD",
            trends: {
              days_1: { price_change: -1, percent_change: -0.27 },
              days_14: { price_change: 12.71, percent_change: 3.53 },
              days_90: { price_change: 72.71, percent_change: 24.24 },
              days_180: { price_change: -27.29, percent_change: -6.82 },
            },
          },
        ] },
      ]),
    );

    expect(audit).toEqual({
      market: 372.71,
      price1d: 373.71,
      price7d: null,
      price14d: 360,
      price30d: null,
      price90d: 300,
      price180d: 400,
      variant: "holofoil",
    });
  });

  it("does not fabricate an NM price from played conditions", () => {
    const audit = getScrydexNmAuditFromCard(
      cardWithVariants([
        { name: "holofoil", prices: [
          {
            condition: "LP",
            is_perfect: false,
            is_signed: false,
            is_error: false,
            type: "raw",
            low: 390,
            market: 392.2,
            currency: "USD",
          },
        ] },
      ]),
    );

    expect(audit).toBeNull();
  });
});
