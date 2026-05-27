import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          solana: ["@solana/web3.js", "@wallet-standard/app"],
          ui: ["lucide-react"]
        }
      }
    }
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@core": fileURLToPath(new URL("./packages/core/src", import.meta.url))
    }
  },
  server: {
    port: 5173,
    strictPort: false
  }
});
