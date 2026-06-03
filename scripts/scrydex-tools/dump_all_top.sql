-- Top 200 cards by price across ALL sets (incl. vintage WOTC/e-Card/EX).
-- Note: this surfaces high-priced vintage cards that the modern "TOP" tab
-- doesn't emphasize. Use dump_modern_top.sql for the modern chase-card view.
SELECT card_id, price, price_1d, price_7d, price_30d
FROM latest_card_prices
WHERE card_id NOT LIKE 'sealed-%'
ORDER BY price DESC
LIMIT 200;
