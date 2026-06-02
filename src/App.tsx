import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import BackgroundLayer from "@/components/BackgroundLayer";
import ErrorBoundary from "@/components/ErrorBoundary";
import SentimentIntroDialog from "@/components/SentimentIntroDialog";

// Lazy-loaded pages for code splitting
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Explore = lazy(() => import("./pages/Explore"));
const Profile = lazy(() => import("./pages/Profile"));
const Auth = lazy(() => import("./pages/Auth"));
const Privacy = lazy(() => import("./pages/Privacy"));
const Terms = lazy(() => import("./pages/Terms"));
const DemoProfile = lazy(() => import("./pages/DemoProfile"));
const CardDetail = lazy(() => import("./pages/CardDetail"));
const SealedDetail = lazy(() => import("./pages/SealedDetail"));
const Games = lazy(() => import("./pages/Games"));
const CardMatch = lazy(() => import("./pages/CardMatch"));
const Stats = lazy(() => import("./pages/Stats"));
const Market = lazy(() => import("./pages/Market"));
const Sets = lazy(() => import("./pages/Sets"));
const SetDetail = lazy(() => import("./pages/SetDetail"));
const Onchain = lazy(() => import("./pages/Onchain"));
const GiveawayConfirm = lazy(() => import("./pages/GiveawayConfirm"));
const AdminOverview = lazy(() => import("./pages/admin/AdminOverview"));
const AdminGiveaways = lazy(() => import("./pages/admin/AdminGiveaways"));
const AdminGiveawayForm = lazy(() => import("./pages/admin/AdminGiveawayForm"));
const AdminPrizes = lazy(() => import("./pages/admin/AdminPrizes"));
const AdminHealth = lazy(() => import("./pages/admin/AdminHealth"));
const AdminFunctions = lazy(() => import("./pages/admin/AdminFunctions"));
const AdminCcDiscovery = lazy(() => import("./pages/admin/AdminCcDiscovery"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <span className="w-6 h-6 animate-spin border-2 border-primary border-t-transparent rounded-full" />
  </div>
);

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <BackgroundLayer />
            <main className="relative z-[1]">
              <ErrorBoundary>
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<Market />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="/explore" element={<Explore />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/privacy" element={<Privacy />} />
                  <Route path="/terms" element={<Terms />} />
                  <Route path="/demo" element={<DemoProfile />} />
                  <Route path="/u/:slug" element={<Profile />} />
                  <Route path="/card/:id" element={<CardDetail />} />
                  <Route path="/sealed/:id" element={<SealedDetail />} />
                  {/* /market route intentionally removed 2026-05-20 — the
                      URL is being reserved for a future "buy/sell" marketplace
                      that will list actual cards for sale. The homepage at /
                      continues to serve the existing Market price-tracker
                      component, unchanged. */}
                  <Route path="/sets" element={<Sets />} />
                  <Route path="/sets/:slug" element={<SetDetail />} />
                  <Route path="/sets/:slug/:cardSlug" element={<CardDetail />} />
                  <Route path="/onchain" element={<Onchain />} />
                  <Route path="/onchain/:tab" element={<Onchain />} />
                  <Route path="/games" element={<Games />} />
                  <Route path="/games/card-match" element={<CardMatch />} />
                  <Route path="/stats" element={<Stats />} />
                  {/* Public giveaway page hidden for now (system needs review).
                      Direct visits redirect home; /confirm stays live so any
                      already-sent double-opt-in email links still work. Admins
                      manage giveaways at /admin/giveaways. */}
                  <Route path="/giveaway" element={<Navigate to="/" replace />} />
                  <Route path="/giveaway/confirm" element={<GiveawayConfirm />} />
                  <Route path="/admin" element={<AdminOverview />} />
                  <Route path="/admin/giveaways" element={<AdminGiveaways />} />
                  <Route path="/admin/giveaways/new" element={<AdminGiveawayForm />} />
                  <Route path="/admin/giveaways/:id" element={<AdminGiveawayForm />} />
                  <Route path="/admin/prizes" element={<AdminPrizes />} />
                  <Route path="/admin/health" element={<AdminHealth />} />
                  <Route path="/admin/functions" element={<AdminFunctions />} />
                  <Route path="/admin/cc-discovery" element={<AdminCcDiscovery />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              </ErrorBoundary>
            </main>
            {/* Global one-time explainer, opens on a user's first sentiment vote */}
            <SentimentIntroDialog />
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;

