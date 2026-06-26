import { defineConfig } from "vitest/config";

// Server-local Vitest config so `corepack pnpm -C server exec vitest run` resolves
// the server's own `test/` files (the root config's `include` is rooted at the
// repo, not the server package). Pure-logic tests run in the node environment;
// type-checking stays a separate `tsc --noEmit` gate. Mirrors the root config.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
  },
});
