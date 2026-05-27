insert into public.verified_tokens (
  mint,
  symbol,
  name,
  logo_url,
  decimals,
  status,
  price_usd,
  change_24h,
  balance,
  liquidity_usd,
  risk_level
) values
  (
    'So11111111111111111111111111111111111111112',
    'SOL',
    'Solana',
    'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png',
    9,
    'verified',
    183.42,
    2.84,
    0,
    892000000,
    'low'
  ),
  (
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    'USDC',
    'USD Coin',
    'https://raw.githubusercontent.com/solana-labs/token-list/main/assets/mainnet/EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v/logo.png',
    6,
    'verified',
    1,
    0.01,
    0,
    1200000000,
    'low'
  )
on conflict (mint) do update set
  symbol = excluded.symbol,
  name = excluded.name,
  logo_url = excluded.logo_url,
  decimals = excluded.decimals,
  status = excluded.status,
  price_usd = excluded.price_usd,
  change_24h = excluded.change_24h,
  liquidity_usd = excluded.liquidity_usd,
  risk_level = excluded.risk_level,
  updated_at = now();
