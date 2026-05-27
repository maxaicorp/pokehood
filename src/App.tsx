import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDownUp,
  BadgeCheck,
  Bell,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  Gift,
  Pause,
  Plus,
  RefreshCcw,
  Search,
  Wallet,
  X
} from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import {
  approvedTokens,
  createTradePreview,
  formatCompactUsd,
  formatPercent,
  formatTokenAmount,
  formatUsd,
  getPortfolioValue,
  getVerifiedTokens,
  tokenReviews
} from "@core/index";
import type { AdminReview, Token } from "@core/types";
import {
  buildJupiterQuoteUrl,
  fetchJupiterQuote,
  fetchJupiterSwapTransaction,
  getQuoteInputAmount,
  getQuoteOutputAmount,
  getRouteLabels,
  type JupiterQuote
} from "./integrations";
import { fetchTokenHistory, type ChartPoint, type ChartRange } from "./charts";
import { appConfig } from "./config";
import { fetchWalletPortfolio } from "./portfolio";
import { refreshTokenPrices } from "./prices";
import { detectTokenMetadata } from "./tokenMetadata";
import {
  fetchStoredTokenReviews,
  fetchStoredVerifiedTokens,
  persistPriceSnapshots,
  persistReviewDecision,
  persistSwapEvent,
  persistTokenSubmission,
  type ReviewDecision,
  type SwapEventInput
} from "./tokenStore";
import {
  connectWallet,
  getWalletOptions,
  shortenAddress,
  signAndSendSwapTransaction,
  type SupportedWalletId,
  type WalletConnection,
  type WalletOption
} from "./wallets";

const ranges: ChartRange[] = ["LIVE", "1D", "1W", "1M", "3M", "YTD", "1Y", "ALL"];

const themes = [
  { id: "pokedex-night", label: "Pokedex Night", colors: ["#0b0f1a", "#ffcb05", "#2a75bb"] },
  { id: "gym-leader", label: "Gym Leader", colors: ["#101820", "#f2aa4c", "#42e8c3"] },
  { id: "pokeball", label: "Pokeball", colors: ["#0f1117", "#e3350d", "#f8fafc"] },
  { id: "safari", label: "Safari", colors: ["#10150f", "#8fd14f", "#f4d35e"] },
  { id: "elite-four", label: "Elite Four", colors: ["#101024", "#d9b8ff", "#ff7a90"] }
] as const;

type ThemeId = (typeof themes)[number]["id"];

type SwapHistoryEvent = SwapEventInput & {
  id: string;
  createdAt: string;
  persistenceStatus: "local" | "saved" | "error";
};

type NotificationItem = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
};

type LiveToken = Token & {
  lastPriceUpdatedAt?: string;
};

type TokenSubmissionInput = {
  mint: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUrl: string;
  liquidityUsd: number;
  riskLevel: Token["riskLevel"];
  note: string;
};

export function App() {
  const [amount, setAmount] = useState(125);
  const [walletConnection, setWalletConnection] = useState<WalletConnection | null>(null);
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>([]);
  const [walletError, setWalletError] = useState("");
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const [tokens, setTokens] = useState<LiveToken[]>(approvedTokens);
  const [reviews, setReviews] = useState<AdminReview[]>(tokenReviews);
  const [portfolioStatus, setPortfolioStatus] = useState<"mock" | "loading" | "live" | "error">("mock");
  const [portfolioError, setPortfolioError] = useState("");
  const [priceStatus, setPriceStatus] = useState<"seed" | "loading" | "live" | "error">("seed");
  const [priceError, setPriceError] = useState("");
  const [selectedMint, setSelectedMint] = useState(getInitialMint());
  const [inputMint, setInputMint] = useState(approvedTokens[1].mint);
  const [outputMint, setOutputMint] = useState(getInitialMint());
  const [activeRange, setActiveRange] = useState<ChartRange>("1D");
  const [tokenQuery, setTokenQuery] = useState("");
  const [adminStatus, setAdminStatus] = useState("");
  const [swapHistory, setSwapHistory] = useState<SwapHistoryEvent[]>([]);
  const [tokenSubmissionOpen, setTokenSubmissionOpen] = useState(false);
  const [navPanel, setNavPanel] = useState<"rewards" | "notifications" | null>(null);
  const [theme, setTheme] = useState<ThemeId>("pokedex-night");

  const verifiedTokens = useMemo(() => getVerifiedTokens(tokens), [tokens]);
  const sortedTokens = useMemo(
    () => [...verifiedTokens].sort((a, b) => b.liquidityUsd - a.liquidityUsd),
    [verifiedTokens]
  );
  const visibleTokens = useMemo(() => {
    const query = tokenQuery.trim().toLowerCase();
    if (!query) return sortedTokens;
    return sortedTokens.filter((token) =>
      [token.symbol, token.name, token.mint].some((value) => value.toLowerCase().includes(query))
    );
  }, [sortedTokens, tokenQuery]);
  const selectedToken = useMemo(
    () => verifiedTokens.find((token) => token.mint === selectedMint) ?? verifiedTokens[0],
    [selectedMint, verifiedTokens]
  );
  const inputToken = useMemo(
    () => verifiedTokens.find((token) => token.mint === inputMint) ?? verifiedTokens[1] ?? verifiedTokens[0],
    [inputMint, verifiedTokens]
  );
  const outputToken = useMemo(
    () => verifiedTokens.find((token) => token.mint === outputMint) ?? selectedToken,
    [outputMint, selectedToken, verifiedTokens]
  );
  const portfolioValue = useMemo(() => getPortfolioValue(verifiedTokens), [verifiedTokens]);
  const buyingPower = verifiedTokens.find((token) => token.symbol === "USDC")?.balance ?? 0;
  const swapVolumeUsd = useMemo(
    () => swapHistory.reduce((total, event) => total + event.outputUsd, 0),
    [swapHistory]
  );
  const rewardPoints = Math.floor(swapVolumeUsd);
  const isAdminWallet = Boolean(
    walletConnection && appConfig.adminWallets.some((wallet) => wallet.toLowerCase() === walletConnection.address.toLowerCase())
  );
  const latestTokens = useMemo(
    () => [...(isAdminWallet ? reviews.map((review) => review.token) : []), ...verifiedTokens].slice(0, 6),
    [isAdminWallet, reviews, verifiedTokens]
  );
  const notifications = useMemo<NotificationItem[]>(() => {
    const items: NotificationItem[] = [];

    if (walletConnection) {
      items.push({
        body: `${shortenAddress(walletConnection.address)} is connected.`,
        createdAt: new Date().toISOString(),
        id: "wallet-connected",
        title: "Wallet connected"
      });
    }

    swapHistory.forEach((event) => {
      items.push({
        body: `${formatTokenAmount(event.inputAmount)} ${event.inputSymbol} swapped for ${formatTokenAmount(event.outputAmount)} ${event.outputSymbol}.`,
        createdAt: event.createdAt,
        id: event.id,
        title: event.persistenceStatus === "saved" ? "Swap saved" : "Swap completed"
      });
    });

    if (isAdminWallet && reviews.length) {
      items.push({
        body: `${reviews.length} token${reviews.length === 1 ? "" : "s"} waiting for manual review.`,
        createdAt: new Date().toISOString(),
        id: "admin-review-queue",
        title: "Review queue"
      });
    }

    return items.slice(0, 8);
  }, [isAdminWallet, reviews.length, swapHistory, walletConnection]);

  useEffect(() => {
    setWalletOptions(getWalletOptions());
    void bootstrapMarketData();
  }, []);

  useEffect(() => {
    if (!verifiedTokens.length) return;

    const intervalId = window.setInterval(() => {
      void refreshPrices(verifiedTokens);
    }, 60_000);

    return () => window.clearInterval(intervalId);
  }, [verifiedTokens]);

  async function bootstrapMarketData() {
    const storedTokens = await refreshStoredTokens();
    await refreshPrices(storedTokens.length ? storedTokens : approvedTokens);
  }

  function selectToken(token: Token) {
    setSelectedMint(token.mint);
    setOutputMint(token.mint);
    setTokenQuery("");
    window.history.replaceState(null, "", `?token=${encodeURIComponent(token.symbol.toLowerCase())}`);
  }

  function handleTokenSearchSubmit() {
    const [firstToken] = visibleTokens;
    if (firstToken) selectToken(firstToken);
  }

  async function handleWalletConnect(walletId: SupportedWalletId) {
    setWalletError("");
    try {
      const connection = await connectWallet(walletId);
      setWalletConnection(connection);
      setWalletMenuOpen(false);
      await refreshPortfolio(connection.address);
    } catch (error) {
      setWalletError(error instanceof Error ? error.message : "Wallet connection failed");
    }
  }

  async function refreshPortfolio(walletAddress = walletConnection?.address) {
    if (!walletAddress) return;

    setPortfolioStatus("loading");
    setPortfolioError("");
    try {
      const portfolio = await fetchWalletPortfolio(walletAddress, tokens);
      setTokens(portfolio.tokens);
      setPortfolioStatus("live");
    } catch (error) {
      setPortfolioStatus("error");
      setPortfolioError(error instanceof Error ? error.message : "Unable to fetch wallet balances");
    }
  }

  async function refreshPrices(sourceTokens = tokens) {
    setPriceStatus("loading");
    setPriceError("");
    try {
      const result = await refreshTokenPrices(sourceTokens);
      const pricedTokens = result.tokens.map((token) => ({
        ...token,
        lastPriceUpdatedAt: result.fetchedAt
      }));
      setTokens(pricedTokens);
      setPriceStatus(result.source === "jupiter" ? "live" : "error");
      setPriceError(result.error ?? "");
      if (result.source === "jupiter") {
        void persistPriceSnapshots(pricedTokens);
      }
    } catch (error) {
      setPriceStatus("error");
      setPriceError(error instanceof Error ? error.message : "Unable to fetch Jupiter prices");
    }
  }

  async function refreshStoredTokens(): Promise<Token[]> {
    try {
      const [storedTokens, storedReviews] = await Promise.all([
        fetchStoredVerifiedTokens(),
        fetchStoredTokenReviews()
      ]);

      if (storedTokens.length) setTokens(storedTokens);
      if (storedReviews.length) setReviews(storedReviews);
      return storedTokens;
    } catch {
      // Local seed data remains the fallback until Supabase is configured.
      return [];
    }
  }

  async function handleReviewDecision(review: AdminReview, decision: ReviewDecision) {
    if (!isAdminWallet) {
      setAdminStatus("Connect the configured admin wallet before changing token status.");
      setWalletMenuOpen(true);
      return;
    }

    const tokenStatus: Token["status"] = decision === "approved" ? "verified" : decision === "paused" ? "paused" : "rejected";
    setAdminStatus(`${review.token.symbol} ${decision}.`);
    setReviews((currentReviews) => currentReviews.filter((item) => item.id !== review.id));
    setTokens((currentTokens) => {
      const nextToken = { ...review.token, status: tokenStatus };
      const exists = currentTokens.some((token) => token.mint === review.token.mint);
      if (exists) {
        return currentTokens.map((token) => token.mint === review.token.mint ? { ...token, status: tokenStatus } : token);
      }
      return [...currentTokens, nextToken];
    });

    try {
      await persistReviewDecision(review, decision, walletConnection?.address ?? "local-admin");
      setAdminStatus(`${review.token.symbol} ${decision} and saved to Supabase.`);
    } catch {
      setAdminStatus(`${review.token.symbol} ${decision} locally. Supabase writes need admin auth or an edge function.`);
    }
  }

  async function handleTokenSubmission(submission: TokenSubmissionInput) {
    if (!isAdminWallet) {
      setAdminStatus("Connect the configured admin wallet before adding tokens to the review queue.");
      setWalletMenuOpen(true);
      return;
    }

    let normalizedMint = "";
    try {
      normalizedMint = new PublicKey(submission.mint.trim()).toBase58();
    } catch {
      setAdminStatus("Enter a valid Solana mint address.");
      return;
    }

    const symbol = submission.symbol.trim().toUpperCase();
    const name = submission.name.trim();
    if (!symbol || !name) {
      setAdminStatus("Token symbol and name are required.");
      return;
    }

    if (tokens.some((token) => token.mint === normalizedMint) || reviews.some((review) => review.token.mint === normalizedMint)) {
      setAdminStatus(`${symbol} is already in the token list or review queue.`);
      return;
    }

    const token: Token = {
      balance: 0,
      change24h: 0,
      decimals: submission.decimals,
      liquidityUsd: submission.liquidityUsd,
      logoUrl: submission.logoUrl.trim() || `https://placehold.co/80x80/111820/eef3f8?text=${encodeURIComponent(symbol.slice(0, 1))}`,
      mint: normalizedMint,
      name,
      priceUsd: 0,
      riskLevel: submission.riskLevel,
      status: "pending",
      symbol
    };
    const review: AdminReview = {
      id: `local-${normalizedMint}-${Date.now()}`,
      note: submission.note.trim() || "Manual admin submission. Verify Jupiter route, liquidity, metadata, and token authority before approval.",
      submittedAt: new Date().toISOString(),
      submittedBy: walletConnection?.address ?? appConfig.adminEmails[0] ?? "local-admin",
      token
    };

    setReviews((currentReviews) => [review, ...currentReviews]);
    setTokens((currentTokens) => [token, ...currentTokens]);
    setTokenSubmissionOpen(false);
    setAdminStatus(`${symbol} added to the local review queue.`);

    try {
      await persistTokenSubmission(review);
      setAdminStatus(`${symbol} added to the review queue and saved to Supabase.`);
    } catch {
      setAdminStatus(`${symbol} added locally. Supabase admin writes need auth policies or an edge function.`);
    }
  }

  async function handleSwapSent(event: SwapEventInput) {
    const historyEvent: SwapHistoryEvent = {
      ...event,
      createdAt: new Date().toISOString(),
      id: event.signature,
      persistenceStatus: "local"
    };

    setSwapHistory((currentHistory) => [historyEvent, ...currentHistory.filter((item) => item.signature !== event.signature)].slice(0, 6));

    try {
      await persistSwapEvent(event);
      setSwapHistory((currentHistory) => currentHistory.map((item) =>
        item.signature === event.signature ? { ...item, persistenceStatus: "saved" } : item
      ));
    } catch {
      setSwapHistory((currentHistory) => currentHistory.map((item) =>
        item.signature === event.signature ? { ...item, persistenceStatus: "error" } : item
      ));
    }
  }

  return (
    <div className={`app-shell theme-${theme}`}>
      <header className="topbar">
        <div className="brand-mark">S</div>
        <div className="search-wrap">
          <label className="search">
            <Search size={22} />
            <input
              onChange={(event) => setTokenQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleTokenSearchSubmit();
              }}
              placeholder="Search"
              value={tokenQuery}
            />
          </label>
          {tokenQuery && <SearchResults onSelectToken={selectToken} tokens={visibleTokens.slice(0, 5)} />}
        </div>
        <nav>
          <div className="nav-popover-wrap">
            <button className={navPanel === "rewards" ? "active" : ""} onClick={() => setNavPanel((panel) => panel === "rewards" ? null : "rewards")}>
              <Gift size={16} /> Rewards
            </button>
            {navPanel === "rewards" && <RewardsPopover points={rewardPoints} volumeUsd={swapVolumeUsd} />}
          </div>
          <div className="nav-popover-wrap">
            <button className={navPanel === "notifications" ? "active" : ""} onClick={() => setNavPanel((panel) => panel === "notifications" ? null : "notifications")}>
              <Bell size={16} /> Notifications
              {notifications.length > 0 && <span className="dot" />}
            </button>
            {navPanel === "notifications" && <NotificationsPopover notifications={notifications} />}
          </div>
        </nav>
        <WalletDropdown
          error={walletError}
          isOpen={walletMenuOpen}
          onConnect={handleWalletConnect}
          onRefresh={() => setWalletOptions(getWalletOptions())}
          onRefreshBalances={() => refreshPortfolio()}
          onToggle={() => setWalletMenuOpen((open) => !open)}
          options={walletOptions}
          portfolioError={portfolioError}
          portfolioStatus={portfolioStatus}
          walletConnection={walletConnection}
        />
      </header>

      <ThemeSwitcher activeTheme={theme} onThemeChange={setTheme} />

      <div className="dashboard-shell">
        <main className="left-scroll">
          <section className="asset-hero">
            <button className="account-switch">{selectedToken.name} <ChevronDown size={20} /></button>
            <h1>{formatUsd(selectedToken.priceUsd, selectedToken.priceUsd < 1 ? 6 : 2)}</h1>
            <p className={selectedToken.change24h >= 0 ? "positive" : "negative"}>
              {formatPercent(selectedToken.change24h)} today
            </p>
            <TokenChart range={activeRange} token={selectedToken} />
            <div className="range-tabs">
              {ranges.map((range) => (
                <button className={activeRange === range ? "selected" : ""} key={range} onClick={() => setActiveRange(range)}>
                  {range}
                </button>
              ))}
            </div>
            <TokenStats token={selectedToken} />
            <div className="buying-power">
              <span>Buying power</span>
              <strong>{formatUsd(buyingPower)}</strong>
            </div>
          </section>

          <DiscoverSection tokens={latestTokens} onSelectToken={selectToken} />
          {isAdminWallet && walletConnection && (
            <AdminPanel
              onAddToken={() => setTokenSubmissionOpen(true)}
              onReviewDecision={handleReviewDecision}
              onSelectToken={selectToken}
              reviews={reviews}
              rewardPoints={rewardPoints}
              status={adminStatus}
              swapCount={swapHistory.length}
              swapVolumeUsd={swapVolumeUsd}
              tokens={tokens}
              walletAddress={walletConnection.address}
            />
          )}
        </main>

        <aside className="right-sidebar">
          <VerifiedTokenList
            onRefresh={refreshPrices}
            onSelectToken={selectToken}
            priceError={priceError}
            priceStatus={priceStatus}
            selectedMint={selectedMint}
            tokens={visibleTokens}
          />
          <TradeTicket
            amount={amount}
            onRequestWalletConnect={() => setWalletMenuOpen(true)}
            onSwapSent={handleSwapSent}
            inputToken={inputToken}
            onAmountChange={setAmount}
            onInputMintChange={setInputMint}
            onOutputMintChange={setOutputMint}
            onSwapTokens={() => {
              setInputMint(outputToken.mint);
              setOutputMint(inputToken.mint);
            }}
            outputToken={outputToken}
            solBalance={verifiedTokens.find((token) => token.symbol === "SOL")?.balance ?? 0}
            tokens={verifiedTokens}
            walletConnection={walletConnection}
          />
          <SwapHistoryPanel events={swapHistory} />
          <UserInfoPanel
            events={swapHistory}
            rewardPoints={rewardPoints}
            walletConnection={walletConnection}
          />
        </aside>
      </div>

      {tokenSubmissionOpen && (
        <TokenSubmissionModal
          onClose={() => setTokenSubmissionOpen(false)}
          onSubmit={handleTokenSubmission}
        />
      )}
    </div>
  );
}

function SearchResults({ onSelectToken, tokens }: { onSelectToken: (token: Token) => void; tokens: Token[] }) {
  return (
    <div className="search-results">
      {tokens.length ? tokens.map((token) => (
        <button key={token.mint} onClick={() => onSelectToken(token)}>
          <TokenAvatar token={token} />
          <span>
            <strong>{token.symbol}</strong>
            <small>{token.name}</small>
          </span>
          <em>{formatCompactUsd(token.liquidityUsd)}</em>
        </button>
      )) : <p>No verified tokens found</p>}
    </div>
  );
}

function ThemeSwitcher({
  activeTheme,
  onThemeChange
}: {
  activeTheme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
}) {
  return (
    <div className="theme-row" aria-label="Theme options">
      <span>Theme</span>
      <div>
        {themes.map((theme) => (
          <button
            className={activeTheme === theme.id ? "selected" : ""}
            key={theme.id}
            onClick={() => onThemeChange(theme.id)}
            type="button"
          >
            <span className="theme-swatch" aria-hidden="true">
              {theme.colors.map((color) => <i key={color} style={{ background: color }} />)}
            </span>
            {theme.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TokenChart({ range, token }: { range: ChartRange; token: LiveToken }) {
  const [points, setPoints] = useState<ChartPoint[]>([]);

  useEffect(() => {
    let cancelled = false;

    fetchTokenHistory(token, range)
      .then((history) => {
        if (cancelled) return;
        setPoints(history);
      })
      .catch(() => {
        if (cancelled) return;
        setPoints([{ price: token.priceUsd, timestamp: Date.now() }]);
      });

    return () => {
      cancelled = true;
    };
  }, [range, token]);

  const width = 900;
  const height = 300;
  const chartPoints = points.length ? points : getFallbackChartPoints(token, range);
  const minPrice = Math.min(...chartPoints.map((point) => point.price));
  const maxPrice = Math.max(...chartPoints.map((point) => point.price));
  const priceRange = Math.max(maxPrice - minPrice, token.priceUsd * 0.002, 0.000000001);
  const svgPoints = chartPoints.map((point, index) => {
    const x = (index / Math.max(chartPoints.length - 1, 1)) * width;
    const y = height - 24 - ((point.price - minPrice) / priceRange) * (height - 48);
    return `${x},${Math.max(24, Math.min(height - 24, y))}`;
  }).join(" ");
  const latestPoint = chartPoints.at(-1);
  const latestIndex = Math.max(chartPoints.length - 1, 0);
  const latestX = (latestIndex / Math.max(chartPoints.length - 1, 1)) * width;
  const latestY = latestPoint
    ? Math.max(24, Math.min(height - 24, height - 24 - ((latestPoint.price - minPrice) / priceRange) * (height - 48)))
    : height / 2;
  const chartColor = token.change24h >= 0 ? "var(--positive)" : "var(--negative)";

  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${token.symbol} chart`}>
        <line x1="0" x2={width} y1="150" y2="150" stroke="#2a333c" strokeDasharray="2 9" />
        <polyline points={svgPoints} fill="none" stroke={chartColor} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        <g className="live-ping" style={{ "--ping-color": chartColor } as React.CSSProperties}>
          <circle className="live-ping-ring" cx={latestX} cy={latestY} r="7" />
          <circle className="live-ping-dot" cx={latestX} cy={latestY} r="4" />
        </g>
      </svg>
    </div>
  );
}

function TokenStats({ token }: { token: LiveToken }) {
  return (
    <div className="token-stats">
      <div>
        <small>Liquidity</small>
        <strong>{formatCompactUsd(token.liquidityUsd)}</strong>
      </div>
      <div>
        <small>Risk</small>
        <strong className={`risk-${token.riskLevel}`}>{token.riskLevel}</strong>
      </div>
      <div>
        <small>Mint</small>
        <strong>{shortenAddress(token.mint)}</strong>
      </div>
      <div>
        <small>Updated</small>
        <strong>{token.lastPriceUpdatedAt ? formatUpdatedAgo(token.lastPriceUpdatedAt) : "Pending"}</strong>
      </div>
    </div>
  );
}

function formatUpdatedAgo(timestamp: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function getFallbackChartPoints(token: Token, range: ChartRange): ChartPoint[] {
  const seed = token.symbol.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0) + ranges.indexOf(range) * 19;
  return Array.from({ length: 64 }, (_, index) => {
    const wave = Math.sin((index + seed) * 0.32) * token.priceUsd * 0.025;
    const drift = token.change24h >= 0 ? index * token.priceUsd * 0.0006 : -index * token.priceUsd * 0.00045;
    const bump = Math.cos((index + seed) * 0.13) * token.priceUsd * 0.014;
    return {
      timestamp: Date.now() - (64 - index) * 60_000,
      price: Math.max(0.000000001, token.priceUsd + wave + drift + bump)
    };
  });
}

function DiscoverSection({ tokens, onSelectToken }: { tokens: Token[]; onSelectToken: (token: Token) => void }) {
  return (
    <section className="discover-section">
      <div className="section-title">
        <h2>Discover verified tokens</h2>
        <small>Latest additions and pending admin reviews</small>
      </div>
      <div className="discover-grid">
        {tokens.map((token) => (
          <button key={token.mint} className="discover-card" onClick={() => onSelectToken(token)}>
            <TokenAvatar token={token} />
            <strong>{token.symbol}</strong>
            <span>{token.name}</span>
            <small>{formatCompactUsd(token.liquidityUsd)} liquidity</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function VerifiedTokenList({
  onRefresh,
  onSelectToken,
  priceError,
  priceStatus,
  selectedMint,
  tokens
}: {
  onRefresh: () => void;
  onSelectToken: (token: Token) => void;
  priceError: string;
  priceStatus: "seed" | "loading" | "live" | "error";
  selectedMint: string;
  tokens: Token[];
}) {
  return (
    <section className="verified-panel">
      <div className="section-heading">
        <div>
          <h2>Actively traded</h2>
          <small>{priceStatus === "live" ? "Prices live from Jupiter" : priceStatus === "loading" ? "Refreshing prices..." : "Seed prices"}</small>
        </div>
        <button className="panel-icon-button" onClick={onRefresh} title="Refresh prices">
          <RefreshCcw size={18} />
        </button>
      </div>
      {priceError && <p className="panel-warning"><AlertTriangle size={15} /> {priceError}</p>}
      <div className="token-list">
        {tokens.map((token) => (
          <button className={selectedMint === token.mint ? "token-row selected" : "token-row"} key={token.mint} onClick={() => onSelectToken(token)}>
            <TokenAvatar token={token} />
            <span>
              <strong>{token.symbol}</strong>
              <small>{formatCompactUsd(token.liquidityUsd)}</small>
            </span>
            <MiniSpark change={token.change24h} />
            <span className="price-cell">
              <strong>{formatUsd(token.priceUsd, token.priceUsd < 1 ? 6 : 2)}</strong>
              <small className={token.change24h >= 0 ? "positive" : "negative"}>{formatPercent(token.change24h)}</small>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function WalletDropdown({
  error,
  isOpen,
  onConnect,
  onRefresh,
  onRefreshBalances,
  onToggle,
  options,
  portfolioError,
  portfolioStatus,
  walletConnection
}: {
  error: string;
  isOpen: boolean;
  onConnect: (walletId: SupportedWalletId) => void;
  onRefresh: () => void;
  onRefreshBalances: () => void;
  onToggle: () => void;
  options: WalletOption[];
  portfolioError: string;
  portfolioStatus: "mock" | "loading" | "live" | "error";
  walletConnection: WalletConnection | null;
}) {
  return (
    <div className="wallet-dropdown">
      <button className="wallet-button" onClick={onToggle}>
        <Wallet size={18} />
        {walletConnection ? shortenAddress(walletConnection.address) : "Connect"}
      </button>
      {isOpen && (
        <div className="wallet-menu">
          <div className="wallet-menu-head">
            <strong>{walletConnection ? "Connected wallet" : "Choose wallet"}</strong>
            <button onClick={onRefresh}>Refresh</button>
          </div>
          {walletConnection && (
            <div className="connected-wallet">
              <WalletIcon option={options.find((option) => option.id === walletConnection.id)} walletName={walletConnection.name} />
              <span>
                <strong>{walletConnection.name}</strong>
                <small>{shortenAddress(walletConnection.address)}</small>
              </span>
              <button onClick={onRefreshBalances} disabled={portfolioStatus === "loading"}>
                {portfolioStatus === "loading" ? "Syncing..." : "Sync balances"}
              </button>
            </div>
          )}
          <div className="wallet-list">
            {options.map((option) => (
              <button className={walletConnection?.id === option.id ? "wallet-option connected" : "wallet-option"} key={option.id} onClick={() => onConnect(option.id)}>
                <WalletIcon option={option} walletName={option.name} />
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.installed ? "Installed" : "Not detected"}</small>
                </span>
                {walletConnection?.id === option.id && <BadgeCheck size={17} />}
              </button>
            ))}
          </div>
          {error && <p className="wallet-error"><AlertTriangle size={15} /> {error}</p>}
          {portfolioError && <p className="wallet-error"><AlertTriangle size={15} /> {portfolioError}</p>}
        </div>
      )}
    </div>
  );
}

function WalletIcon({ option, walletName }: { option?: WalletOption; walletName: string }) {
  return (
    <span className="wallet-icon" aria-hidden="true">
      {option?.iconUrl
        ? <img src={option.iconUrl} alt="" />
        : walletName.slice(0, 1)}
    </span>
  );
}

function SwapHistoryPanel({ events }: { events: SwapHistoryEvent[] }) {
  return (
    <section className="swap-history-panel">
      <div className="section-heading">
        <div>
          <h2>Recent swaps</h2>
          <small>{events.length ? "Local session history" : "Completed swaps appear here"}</small>
        </div>
      </div>
      <div className="swap-history-list">
        {events.length ? events.map((event) => (
          <a
            className="swap-history-row"
            href={`https://solscan.io/tx/${event.signature}`}
            key={event.id}
            rel="noreferrer"
            target="_blank"
          >
            <span>
              <strong>{event.inputSymbol} to {event.outputSymbol}</strong>
              <small>{formatTokenAmount(event.inputAmount)} {event.inputSymbol} for {formatTokenAmount(event.outputAmount)} {event.outputSymbol}</small>
            </span>
            <em className={event.persistenceStatus === "saved" ? "positive" : event.persistenceStatus === "error" ? "negative" : ""}>
              {event.persistenceStatus === "saved" ? "Saved" : event.persistenceStatus === "error" ? "Local" : "Pending"}
            </em>
          </a>
        )) : <p className="empty-history-state">No swaps yet.</p>}
      </div>
    </section>
  );
}

function MiniSpark({ change }: { change: number }) {
  const color = change >= 0 ? "var(--positive)" : "var(--negative)";
  return (
    <svg className="spark" viewBox="0 0 74 32" aria-hidden="true">
      <polyline
        points={change >= 0 ? "2,24 12,22 18,15 28,18 36,7 48,11 57,6 72,9" : "2,8 12,12 20,9 30,16 42,13 53,21 63,19 72,26"}
        fill="none"
        stroke={color}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TradeTicket({
  amount,
  inputToken,
  onRequestWalletConnect,
  onAmountChange,
  onInputMintChange,
  onOutputMintChange,
  onSwapTokens,
  onSwapSent,
  outputToken,
  solBalance,
  tokens,
  walletConnection
}: {
  amount: number;
  inputToken: Token;
  onRequestWalletConnect: () => void;
  onAmountChange: (value: number) => void;
  onInputMintChange: (value: string) => void;
  onOutputMintChange: (value: string) => void;
  onSwapTokens: () => void;
  onSwapSent: (event: SwapEventInput) => void;
  outputToken: Token;
  solBalance: number;
  tokens: Token[];
  walletConnection: WalletConnection | null;
}) {
  const [quote, setQuote] = useState<JupiterQuote | null>(null);
  const [quoteStatus, setQuoteStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [quoteError, setQuoteError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const inputValueUsd = amount * inputToken.priceUsd;
  const preview = createTradePreview("buy", outputToken, inputValueUsd);
  const quoteRequest = { inputToken, outputToken, inputAmount: amount, slippageBps: 50 };
  const quoteUrl = inputToken.mint === outputToken.mint ? "" : buildJupiterQuoteUrl(quoteRequest);
  const validationMessage = getSwapValidationMessage({
    inputAmount: amount,
    inputToken,
    outputToken,
    solBalance,
    walletConnection
  });
  const canPreview = !validationMessage && quoteStatus !== "loading";

  async function handlePreviewTrade() {
    if (!walletConnection) {
      onRequestWalletConnect();
      return;
    }

    if (validationMessage) {
      setQuote(null);
      setQuoteStatus("error");
      setQuoteError(validationMessage);
      setModalOpen(true);
      return;
    }

    setQuoteStatus("loading");
    setQuoteError("");
    setModalOpen(true);
    try {
      const nextQuote = await fetchJupiterQuote(quoteRequest);
      setQuote(nextQuote);
      setQuoteStatus("ready");
    } catch (error) {
      setQuote(null);
      setQuoteStatus("error");
      setQuoteError(error instanceof Error ? error.message : "Unable to fetch Jupiter quote");
    }
  }

  return (
    <section className="swap-box">
      <div className="swap-box-head">
        <h2>Swap</h2>
        <span><BadgeCheck size={14} /> Verified only</span>
      </div>

      <SwapTokenPanel amount={amount} label="Pay" onAmountChange={onAmountChange} onMintChange={onInputMintChange} token={inputToken} tokens={tokens} />
      <button className="swap-direction-floating" onClick={onSwapTokens} title="Swap direction">
        <ArrowDownUp size={18} />
      </button>
      <SwapTokenPanel amount={preview.estimatedTokenAmount} label="Receive" onMintChange={onOutputMintChange} token={outputToken} tokens={tokens} usdAmount={inputValueUsd} />

      <div className="preview-grid">
        <span>You pay</span><strong>{formatTokenAmount(amount)} {inputToken.symbol}</strong>
        <span>Estimated receive</span><strong>{formatTokenAmount(preview.estimatedTokenAmount)} {outputToken.symbol}</strong>
        <span>Route</span><strong>{inputToken.symbol} to {outputToken.symbol}</strong>
      </div>
      {validationMessage && <p className="swap-validation"><AlertTriangle size={15} /> {validationMessage}</p>}
      {quoteUrl && <a className="quote-link" href={quoteUrl} target="_blank" rel="noreferrer">View Jupiter quote</a>}
      <p className="swap-risk-note">Quotes can move before signing. Review the wallet prompt before approving.</p>
      <button className="primary-action" disabled={walletConnection ? !canPreview : false} onClick={handlePreviewTrade}>
        {!walletConnection ? "Connect wallet" : quoteStatus === "loading" ? "Fetching quote..." : "Preview swap"}
      </button>

      {modalOpen && (
        <TradePreviewModal
          amount={amount}
          inputToken={inputToken}
          onClose={() => setModalOpen(false)}
          outputToken={outputToken}
          quote={quote}
          quoteError={quoteError}
          quoteStatus={quoteStatus}
          onSwapSent={onSwapSent}
          walletConnection={walletConnection}
        />
      )}
    </section>
  );
}

function getSwapValidationMessage({
  inputAmount,
  inputToken,
  outputToken,
  solBalance,
  walletConnection
}: {
  inputAmount: number;
  inputToken: Token;
  outputToken: Token;
  solBalance: number;
  walletConnection: WalletConnection | null;
}) {
  if (!walletConnection) return "";
  if (!Number.isFinite(inputAmount) || inputAmount <= 0) return "Enter an amount greater than 0.";
  if (inputToken.mint === outputToken.mint) return "Choose two different tokens to swap.";
  if (inputToken.balance <= 0) return `No ${inputToken.symbol} balance found in this wallet.`;
  if (inputAmount > inputToken.balance) {
    return `Insufficient ${inputToken.symbol}. Available: ${formatTokenAmount(inputToken.balance)} ${inputToken.symbol}.`;
  }
  if (solBalance < 0.003) return "Keep at least 0.003 SOL available for network fees.";
  return "";
}

function SwapTokenPanel({
  amount,
  label,
  onAmountChange,
  onMintChange,
  token,
  tokens,
  usdAmount
}: {
  amount: number;
  label: string;
  onAmountChange?: (value: number) => void;
  onMintChange: (value: string) => void;
  token: Token;
  tokens: Token[];
  usdAmount?: number;
}) {
  return (
    <section className="swap-token-panel">
      <div>
        <span>{label}</span>
        <select value={token.mint} onChange={(event) => onMintChange(event.target.value)}>
          {tokens.map((tokenOption) => (
            <option key={tokenOption.mint} value={tokenOption.mint}>{tokenOption.symbol}</option>
          ))}
        </select>
      </div>
      <input
        min="0"
        onChange={(event) => onAmountChange?.(Number(event.target.value) || 0)}
        readOnly={!onAmountChange}
        type="number"
        value={Number.isFinite(amount) ? Number(amount.toFixed(6)) : 0}
      />
      <small>{formatUsd(usdAmount ?? amount * token.priceUsd)}</small>
    </section>
  );
}

function TradePreviewModal({
  amount,
  inputToken,
  onClose,
  onSwapSent,
  outputToken,
  quote,
  quoteError,
  quoteStatus,
  walletConnection
}: {
  amount: number;
  inputToken: Token;
  onClose: () => void;
  onSwapSent: (event: SwapEventInput) => void;
  outputToken: Token;
  quote: JupiterQuote | null;
  quoteError: string;
  quoteStatus: "idle" | "loading" | "ready" | "error";
  walletConnection: WalletConnection | null;
}) {
  const [swapStatus, setSwapStatus] = useState<"idle" | "building" | "sent" | "error">("idle");
  const [swapError, setSwapError] = useState("");
  const [signature, setSignature] = useState("");
  const outputAmount = quote ? getQuoteOutputAmount(quote, outputToken.decimals) : 0;
  const inputAmount = quote ? getQuoteInputAmount(quote, inputToken.decimals) : 0;
  const outputUsd = outputAmount * outputToken.priceUsd;
  const routeLabels = quote ? getRouteLabels(quote) : [];

  async function handleContinueToWallet() {
    if (!quote) return;
    if (!walletConnection) {
      setSwapStatus("error");
      setSwapError("Connect a wallet before signing a swap.");
      return;
    }

    setSwapStatus("building");
    setSwapError("");
    setSignature("");
    try {
      const swap = await fetchJupiterSwapTransaction(quote, walletConnection.address);
      const nextSignature = await signAndSendSwapTransaction(walletConnection, swap.swapTransaction);
      setSignature(nextSignature);
      setSwapStatus("sent");
      onSwapSent({
        inputAmount,
        inputMint: inputToken.mint,
        inputSymbol: inputToken.symbol,
        outputAmount,
        outputMint: outputToken.mint,
        outputSymbol: outputToken.symbol,
        outputUsd,
        route: routeLabels.length ? routeLabels.join(", ") : "Jupiter best route",
        signature: nextSignature,
        walletAddress: walletConnection.address
      });
    } catch (error) {
      setSwapStatus("error");
      setSwapError(getFriendlySwapError(error));
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="trade-modal" role="dialog" aria-modal="true" aria-label="Trade preview">
        <div className="modal-head">
          <div>
            <p>Swap preview</p>
            <h2>{inputToken.symbol} to {outputToken.symbol}</h2>
          </div>
          <button onClick={onClose} title="Close preview"><X size={20} /></button>
        </div>

        {quoteStatus === "loading" && <div className="quote-state">Fetching best Jupiter route...</div>}
        {quoteStatus === "error" && <div className="quote-state error"><AlertTriangle size={16} /> {quoteError}</div>}
        {quoteStatus === "ready" && quote && (
          <>
            <div className="trade-summary">
              <span>{formatTokenAmount(amount)} {inputToken.symbol}</span>
              <strong>{formatTokenAmount(outputAmount)} {outputToken.symbol}</strong>
              <small>Estimated value {formatUsd(outputUsd)}</small>
            </div>
            <div className="preview-grid modal-grid">
              <span>You pay</span><strong>{formatTokenAmount(inputAmount)} {inputToken.symbol}</strong>
              <span>You receive</span><strong>{formatTokenAmount(outputAmount)} {outputToken.symbol}</strong>
              <span>Slippage</span><strong>{quote.slippageBps / 100}%</strong>
              <span>Price impact</span><strong>{formatPercent(Number(quote.priceImpactPct) * 100)}</strong>
              <span>Route</span><strong>{routeLabels.length ? routeLabels.join(", ") : "Jupiter best route"}</strong>
            </div>
            {swapError && <div className="quote-state error"><AlertTriangle size={16} /> {swapError}</div>}
            {signature && <a className="signature-link" href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer">View transaction on Solscan</a>}
            <button className="primary-action" disabled={swapStatus === "building" || swapStatus === "sent"} onClick={handleContinueToWallet}>
              {swapStatus === "building" ? "Opening wallet..." : swapStatus === "sent" ? "Transaction sent" : "Continue to wallet signing"}
            </button>
          </>
        )}
      </section>
    </div>
  );
}

function getFriendlySwapError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unable to build or sign swap";
  const normalized = message.toLowerCase();

  if (normalized.includes("reject") || normalized.includes("decline") || normalized.includes("cancel")) {
    return "Swap was cancelled in your wallet.";
  }

  if (normalized.includes("wallet-standard")) {
    return "This wallet connected successfully, but swap signing is currently wired for injected wallet providers first.";
  }

  if (normalized.includes("blockhash") || normalized.includes("expired")) {
    return "The quote expired before signing. Close this preview and fetch a fresh quote.";
  }

  return message;
}

function RewardsPopover({ points, volumeUsd }: { points: number; volumeUsd: number }) {
  return (
    <div className="nav-popover rewards-popover">
      <div className="reward-total">
        <small>Reward points</small>
        <strong>{points.toLocaleString()}</strong>
      </div>
      <p>Earn 1 point for every dollar swapped.</p>
      <div className="mini-stat-row">
        <span>Swap volume</span>
        <strong>{formatUsd(volumeUsd)}</strong>
      </div>
    </div>
  );
}

function NotificationsPopover({ notifications }: { notifications: NotificationItem[] }) {
  return (
    <div className="nav-popover notifications-popover">
      <h3>Notifications</h3>
      {notifications.length ? notifications.map((notification) => (
        <article key={notification.id}>
          <strong>{notification.title}</strong>
          <span>{notification.body}</span>
          <small>{formatUpdatedAgo(notification.createdAt)}</small>
        </article>
      )) : <p>No notifications yet.</p>}
    </div>
  );
}

function UserInfoPanel({
  events,
  rewardPoints,
  walletConnection
}: {
  events: SwapHistoryEvent[];
  rewardPoints: number;
  walletConnection: WalletConnection | null;
}) {
  const totalVolume = events.reduce((sum, event) => sum + event.outputUsd, 0);

  return (
    <section className="user-info-panel">
      <div className="section-heading">
        <div>
          <h2>User info</h2>
          <small>{walletConnection ? shortenAddress(walletConnection.address) : "Connect a wallet to track activity"}</small>
        </div>
      </div>
      <div className="user-metrics">
        <div>
          <small>Rewards</small>
          <strong>{rewardPoints.toLocaleString()} pts</strong>
        </div>
        <div>
          <small>Swap volume</small>
          <strong>{formatUsd(totalVolume)}</strong>
        </div>
        <div>
          <small>Swaps</small>
          <strong>{events.length}</strong>
        </div>
      </div>
    </section>
  );
}

function AdminHealthPanel({
  latestPriceUpdate,
  pendingReviews,
  pricedTokens,
  tokens,
  verifiedTokens
}: {
  latestPriceUpdate: string | undefined;
  pendingReviews: number;
  pricedTokens: number;
  tokens: LiveToken[];
  verifiedTokens: number;
}) {
  const healthItems = [
    {
      detail: appConfig.jupiterApiKey ? `${pricedTokens}/${verifiedTokens} priced` : "Missing API key",
      label: "Jupiter",
      status: appConfig.jupiterApiKey && pricedTokens > 0 ? "online" : "warning"
    },
    {
      detail: appConfig.heliusApiKey ? appConfig.cluster : "Missing API key",
      label: "Helius",
      status: appConfig.heliusApiKey ? "online" : "warning"
    },
    {
      detail: appConfig.supabaseConfigured ? "Configured" : "Missing env",
      label: "Supabase",
      status: appConfig.supabaseConfigured ? "online" : "warning"
    },
    {
      detail: latestPriceUpdate ? formatUpdatedAgo(latestPriceUpdate) : "No live update",
      label: "Prices",
      status: latestPriceUpdate ? "online" : "warning"
    }
  ];

  return (
    <div className="admin-health-panel">
      <div className="section-heading">
        <div>
          <h2>System health</h2>
          <small>Token data and provider status</small>
        </div>
      </div>
      <div className="health-grid">
        {healthItems.map((item) => (
          <div className={`health-card ${item.status}`} key={item.label}>
            <span />
            <small>{item.label}</small>
            <strong>{item.detail}</strong>
          </div>
        ))}
      </div>
      <div className="token-health-table">
        <div className="token-health-summary">
          <span>{tokens.length} total tokens</span>
          <span>{verifiedTokens} verified</span>
          <span>{pendingReviews} pending</span>
        </div>
        {tokens.slice(0, 8).map((token) => (
          <button key={token.mint} className="token-health-row" type="button">
            <TokenAvatar token={token} />
            <span>
              <strong>{token.symbol}</strong>
              <small>{token.status}</small>
            </span>
            <em>{formatUsd(token.priceUsd, token.priceUsd < 1 ? 6 : 2)}</em>
            <small>{token.lastPriceUpdatedAt ? formatUpdatedAgo(token.lastPriceUpdatedAt) : "Pending"}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function AdminPanel({
  onAddToken,
  onReviewDecision,
  onSelectToken,
  rewardPoints,
  reviews,
  swapCount,
  swapVolumeUsd,
  status,
  tokens,
  walletAddress
}: {
  onAddToken: () => void;
  onReviewDecision: (review: AdminReview, decision: ReviewDecision) => void;
  onSelectToken: (token: Token) => void;
  rewardPoints: number;
  reviews: AdminReview[];
  swapCount: number;
  swapVolumeUsd: number;
  status: string;
  tokens: LiveToken[];
  walletAddress: string;
}) {
  const verifiedTokens = tokens.filter((token) => token.status === "verified");
  const pricedTokens = verifiedTokens.filter((token) => Boolean(token.lastPriceUpdatedAt));
  const latestPriceUpdate = pricedTokens
    .map((token) => token.lastPriceUpdatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <section className="admin-panel">
      <div className="admin-heading">
        <div>
          <p>Admin workspace</p>
          <h2>Token verification queue</h2>
        </div>
        <button onClick={onAddToken}><Plus size={17} /> Add new</button>
      </div>
      <div className="admin-status ready">
        <BadgeCheck size={15} />
        <span>{status || "Admin wallet connected. Manual review actions are enabled."}</span>
      </div>
      <div className="admin-user-summary">
        <div>
          <small>Active wallet</small>
          <strong>{shortenAddress(walletAddress)}</strong>
        </div>
        <div>
          <small>Rewards</small>
          <strong>{rewardPoints.toLocaleString()} pts</strong>
        </div>
        <div>
          <small>Swap volume</small>
          <strong>{formatUsd(swapVolumeUsd)}</strong>
        </div>
        <div>
          <small>Swaps</small>
          <strong>{swapCount}</strong>
        </div>
      </div>
      <AdminHealthPanel
        latestPriceUpdate={latestPriceUpdate}
        pendingReviews={reviews.length}
        pricedTokens={pricedTokens.length}
        tokens={tokens}
        verifiedTokens={verifiedTokens.length}
      />
      <div className="review-table">
        {reviews.length ? reviews.map((review) => (
          <article key={review.id} className="review-row">
            <div className="review-token">
              <TokenAvatar token={review.token} />
              <div>
                <strong>{review.token.symbol}</strong>
                <span>{review.token.name}</span>
              </div>
            </div>
            <div><small>Liquidity</small><strong>{formatCompactUsd(review.token.liquidityUsd)}</strong></div>
            <div><small>Risk</small><strong className={`risk-${review.token.riskLevel}`}>{review.token.riskLevel}</strong></div>
            <div><small>Status</small><strong><Clock3 size={15} /> Pending</strong></div>
            <p>{review.note}</p>
            <div className="review-actions">
              <button onClick={() => onSelectToken(review.token)} title="View token"><Eye size={17} /></button>
              <button onClick={() => onReviewDecision(review, "approved")} title="Approve token"><Check size={17} /></button>
              <button onClick={() => onReviewDecision(review, "paused")} title="Pause token"><Pause size={17} /></button>
              <button onClick={() => onReviewDecision(review, "rejected")} title="Reject token"><X size={17} /></button>
            </div>
          </article>
        )) : <div className="empty-review-state">No pending tokens to review.</div>}
      </div>
    </section>
  );
}

function TokenSubmissionModal({
  onClose,
  onSubmit
}: {
  onClose: () => void;
  onSubmit: (submission: TokenSubmissionInput) => void;
}) {
  const [form, setForm] = useState<TokenSubmissionInput>({
    decimals: 6,
    liquidityUsd: 0,
    logoUrl: "",
    mint: "",
    name: "",
    note: "",
    riskLevel: "medium",
    symbol: ""
  });
  const [formError, setFormError] = useState("");
  const [detectStatus, setDetectStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

  function updateForm<K extends keyof TokenSubmissionInput>(key: K, value: TokenSubmissionInput[K]) {
    setForm((currentForm) => ({ ...currentForm, [key]: value }));
  }

  async function handleDetectMetadata() {
    setFormError("");

    let normalizedMint = "";
    try {
      normalizedMint = new PublicKey(form.mint.trim()).toBase58();
    } catch {
      setFormError("Enter a valid Solana mint address before detecting metadata.");
      return;
    }

    setDetectStatus("loading");
    try {
      const metadata = await detectTokenMetadata(normalizedMint);
      setForm((currentForm) => ({
        ...currentForm,
        decimals: metadata.decimals,
        liquidityUsd: metadata.liquidityUsd,
        logoUrl: metadata.logoUrl,
        mint: metadata.mint,
        name: metadata.name,
        note: currentForm.note || metadata.note,
        riskLevel: metadata.riskLevel,
        symbol: metadata.symbol
      }));
      setDetectStatus("ready");
    } catch (error) {
      setDetectStatus("error");
      setFormError(error instanceof Error ? error.message : "Token metadata lookup failed.");
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");

    try {
      new PublicKey(form.mint.trim());
    } catch {
      setFormError("Enter a valid Solana mint address.");
      return;
    }

    if (!form.symbol.trim() || !form.name.trim()) {
      setFormError("Token symbol and name are required.");
      return;
    }

    if (!Number.isInteger(form.decimals) || form.decimals < 0 || form.decimals > 12) {
      setFormError("Decimals must be a whole number from 0 to 12.");
      return;
    }

    onSubmit(form);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="trade-modal token-submit-modal" role="dialog" aria-modal="true" aria-label="Add token review">
        <div className="modal-head">
          <div>
            <p>Admin review</p>
            <h2>Add new token</h2>
          </div>
          <button onClick={onClose} title="Close form"><X size={20} /></button>
        </div>

        <form className="token-submit-form" onSubmit={handleSubmit}>
          <div className="detect-row">
            <label>
              <span>Mint address</span>
              <input
                autoFocus
                onChange={(event) => {
                  updateForm("mint", event.target.value);
                  setDetectStatus("idle");
                }}
                placeholder="Solana token mint"
                value={form.mint}
              />
            </label>
            <button disabled={detectStatus === "loading"} onClick={handleDetectMetadata} type="button">
              {detectStatus === "loading" ? "Detecting..." : "Detect"}
            </button>
          </div>
          {detectStatus === "ready" && <div className="detect-status"><BadgeCheck size={15} /> Metadata autofilled. Review before submitting.</div>}
          <div className="form-grid">
            <label>
              <span>Symbol</span>
              <input
                maxLength={12}
                onChange={(event) => updateForm("symbol", event.target.value)}
                placeholder="SOL"
                value={form.symbol}
              />
            </label>
            <label>
              <span>Decimals</span>
              <input
                max="12"
                min="0"
                onChange={(event) => updateForm("decimals", Number(event.target.value))}
                type="number"
                value={form.decimals}
              />
            </label>
          </div>
          <label>
            <span>Name</span>
            <input
              onChange={(event) => updateForm("name", event.target.value)}
              placeholder="Token name"
              value={form.name}
            />
          </label>
          <div className="form-grid">
            <label>
              <span>Liquidity estimate</span>
              <input
                min="0"
                onChange={(event) => updateForm("liquidityUsd", Number(event.target.value) || 0)}
                type="number"
                value={form.liquidityUsd}
              />
            </label>
            <label>
              <span>Risk</span>
              <select
                onChange={(event) => updateForm("riskLevel", event.target.value as Token["riskLevel"])}
                value={form.riskLevel}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <label>
            <span>Logo URL</span>
            <input
              onChange={(event) => updateForm("logoUrl", event.target.value)}
              placeholder="Optional"
              value={form.logoUrl}
            />
          </label>
          <label>
            <span>Review note</span>
            <textarea
              onChange={(event) => updateForm("note", event.target.value)}
              placeholder="Manual review notes"
              rows={3}
              value={form.note}
            />
          </label>
          {formError && <div className="quote-state error compact"><AlertTriangle size={16} /> {formError}</div>}
          <button className="primary-action" type="submit">Submit token</button>
        </form>
      </section>
    </div>
  );
}

function TokenAvatar({ token }: { token: Token }) {
  return (
    <span className={`token-avatar avatar-${token.symbol.toLowerCase()}`}>
      <img src={token.logoUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />
      <span>{token.symbol.slice(0, 1)}</span>
    </span>
  );
}

function getInitialMint(): string {
  const symbol = new URLSearchParams(window.location.search).get("token");
  return approvedTokens.find((token) => token.symbol.toLowerCase() === symbol?.toLowerCase())?.mint ?? approvedTokens[0].mint;
}
