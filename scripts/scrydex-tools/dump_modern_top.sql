-- Top 150 MODERN-ERA cards by price (Scarlet & Violet + Mega Evolution).
-- This is the set the Market "TOP" tab shows when filtered to "Modern Era".
-- Run in the Supabase SQL editor, save the result (incl. header) to a text
-- file, then feed it to validate_prices.py.
SELECT card_id, price, price_1d, price_7d, price_30d
FROM latest_card_prices
WHERE split_part(card_id, '-', 1) IN
  ('me1','me2','me2pt5','me3','me4','mep','rsv10pt5',
   'sv1','sv2','sv3','sv3pt5','sv4','sv4pt5','sv5','sv6','sv6pt5','sv7','sv8','sv8pt5','sv9','sv10','sve','svp','zsv10pt5')
ORDER BY price DESC
LIMIT 150;
