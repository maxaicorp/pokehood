-- Read the Scrydex webhook observations (after the observer has run a day or two).
-- Tells us cadence, volume, which events fire, payload size, and whether our
-- signing secret verifies — the facts we need to design the real pipeline.

-- 1) Is the secret right? (should be ~100% true once SCRYDEX_WEBHOOK_SECRET is set)
SELECT sig_valid, count(*) FROM public.webhook_events_log GROUP BY sig_valid;

-- 2) Cadence: deliveries per hour
SELECT date_trunc('hour', received_at) AS hour, count(*) AS deliveries,
       sum(expansion_count) AS total_expansions_touched
FROM public.webhook_events_log
GROUP BY 1 ORDER BY 1 DESC LIMIT 48;

-- 3) Which events fire + how big the payloads are
SELECT event_name,
       count(*) AS deliveries,
       round(avg(expansion_count), 1) AS avg_expansions,
       max(expansion_count) AS max_expansions,
       sum(expansion_count) AS total_expansions
FROM public.webhook_events_log
GROUP BY event_name ORDER BY deliveries DESC;

-- 4) Overall span + rate
SELECT count(*) AS total_deliveries,
       min(received_at) AS first_seen, max(received_at) AS last_seen,
       round(count(*) / GREATEST(EXTRACT(EPOCH FROM (max(received_at) - min(received_at)))/3600, 1), 1) AS per_hour
FROM public.webhook_events_log;

-- 5) How many DISTINCT expansions actually changed in the window (the real fetch
--    workload if we re-fetch each changed expansion)
SELECT count(DISTINCT e) AS distinct_expansions
FROM public.webhook_events_log, jsonb_array_elements_text(expansion_ids) e;

-- 6) Eyeball the latest few raw payloads
SELECT received_at, event_name, expansion_count, sig_valid, raw
FROM public.webhook_events_log ORDER BY received_at DESC LIMIT 10;
