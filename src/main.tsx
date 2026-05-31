import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";
import { installCacheInvalidation } from "@/lib/cache-invalidation";
import { installGlobalHaptics } from "@/lib/haptics";

// Clear in-memory price/catalog caches when another tab signals a refresh.
// Installed before render so it runs ahead of any page-level bump handler.
installCacheInvalidation();
// Light haptic on every interactive tap (Android web; no-op on iOS/desktop).
installGlobalHaptics();

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>,
);
