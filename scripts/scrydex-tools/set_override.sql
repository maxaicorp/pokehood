-- Manually pin ONE card's price + deltas as the source of truth.
-- The override survives every daily cron/refresh until you clear it.
-- (This is the raw-SQL equivalent of the admin_set_card_price RPC; we write the
--  table directly because the SQL editor runs privileged with no auth.uid().)
--
-- Edit the VALUES line, run, done. Add more rows for multiple cards.
INSERT INTO public.card_price_overrides
  (card_id, price, price_1d, price_7d, price_30d, card_name, set_name, note, set_at)
VALUES
  ('me2pt5-284', 1398.89, 1396.39, 1336.83, 1262.94, 'Mega Gengar ex', 'Ascended Heroes', 'manual NM fix', now())
ON CONFLICT (card_id) DO UPDATE SET
  price=EXCLUDED.price, price_1d=EXCLUDED.price_1d, price_7d=EXCLUDED.price_7d,
  price_30d=EXCLUDED.price_30d, card_name=EXCLUDED.card_name, set_name=EXCLUDED.set_name,
  note=EXCLUDED.note, set_at=now();

SELECT public.refresh_latest_card_prices();

-- To remove a pin and let the pipeline take back over:
--   DELETE FROM public.card_price_overrides WHERE card_id = 'me2pt5-284';
--   SELECT public.refresh_latest_card_prices();
