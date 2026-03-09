export const STRIPE_CONFIG = {
  pro: {
    product_id: "prod_U6xfYCvDjHNdHo",
    price_id: "price_1T8jkGLnRJTz1GDrjCLm99NR",
    name: "Collectiblez Pro",
    price: "$20/year",
  },
} as const;

export const FREE_TIER_LIMITS = {
  maxCards: 20,
  maxLinks: 2,
  customSlug: false,
  maxWishlists: 1,
  maxWishlistCards: 20,
} as const;

export const PRO_TIER_LIMITS = {
  maxCards: Infinity,
  maxLinks: Infinity,
  customSlug: true,
  maxWishlists: Infinity,
  maxWishlistCards: Infinity,
} as const;
