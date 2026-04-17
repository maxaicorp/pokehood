import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import Dashboard from "./pages/Dashboard";
import Explore from "./pages/Explore";
import Profile from "./pages/Profile";
import Auth from "./pages/Auth";
import Privacy from "./pages/Privacy";
import Terms from "./pages/Terms";
import DemoProfile from "./pages/DemoProfile";
import CardDetail from "./pages/CardDetail";
import SealedDetail from "./pages/SealedDetail";
import Market from "./pages/Market";
import Sets from "./pages/Sets";
import Onchain from "./pages/Onchain";
import NotFound from "./pages/NotFound";
import BackgroundLayer from "@/components/BackgroundLayer";

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthProvider>
            <BackgroundLayer />
            <div className="relative z-[1]">
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
                <Route path="*" element={<NotFound />} />
              </Routes>
            </div>
          </AuthProvider>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
