import { defineConfig } from "vitest/config";
import path from "path";

// Dedicated Vitest config (kept separate from vite.config.ts so the build-only
// HTML/enter-dev plugins never load under test). Pure-logic netcode tests run in
// the node environment; no jsdom needed. Type-checking stays a separate
// `tsc --noEmit` gate — Vitest strips types via esbuild, it does not type-check.
// See docs/systems/netcode-testing.md.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
});
