import { Suspense, lazy } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import BackgroundLayer from "@/components/BackgroundLayer";

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
const Onchain = lazy(() => import("./pages/Onchain"));
const Giveaway = lazy(() => import("./pages/Giveaway"));
const GiveawayConfirm = lazy(() => import("./pages/GiveawayConfirm"));
const AdminOverview = lazy(() => import("./pages/admin/AdminOverview"));
const AdminGiveaways = lazy(() => import("./pages/admin/AdminGiveaways"));
const AdminGiveawayForm = lazy(() => import("./pages/admin/AdminGiveawayForm"));
const AdminPrizes = lazy(() => import("./pages/admin/AdminPrizes"));
const AdminHealth = lazy(() => import("./pages/admin/AdminHealth"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const PageLoader = () => (
  <div className="min-h-screen bg-background flex items-center justify-center">
    <span className="w-6 h-6 animate-spin border-2 border-primary border-t-transparent rounded-full" />
  </div>
);

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <BackgroundLayer />
            <main className="relative z-[1]">
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
                  <Route path="/market" element={<Market />} />
                  <Route path="/sets" element={<Sets />} />
                  <Route path="/onchain" element={<Onchain />} />
                  <Route path="/games" element={<Games />} />
                  <Route path="/games/card-match" element={<CardMatch />} />
                  <Route path="/stats" element={<Stats />} />
                  <Route path="/giveaway" element={<Giveaway />} />
                  <Route path="/giveaway/confirm" element={<GiveawayConfirm />} />
                  <Route path="/admin" element={<AdminOverview />} />
                  <Route path="/admin/giveaways" element={<AdminGiveaways />} />
                  <Route path="/admin/giveaways/new" element={<AdminGiveawayForm />} />
                  <Route path="/admin/giveaways/:id" element={<AdminGiveawayForm />} />
                  <Route path="/admin/prizes" element={<AdminPrizes />} />
                  <Route path="/admin/health" element={<AdminHealth />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </main>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;

