import { defineConfig } from "tsup";

// Bundle the whole server (elysia + @elysiajs/* + ws + postgres) into ONE
// self-contained ESM file so the Shard Cloud container can start prebuilt JS
// with no build step. Static SPA files are NOT inlined (@elysiajs/static reads
// them from disk at runtime) — they ship alongside as deploy/public.
export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["esm"],
  platform: "node",
  target: "node20",
  bundle: true,
  minify: false,
  noExternal: [/(.*)/], // inline all deps
  external: ["pg-native"], // optional native dep postgres may probe
  splitting: false,
  clean: true,
  // Some bundled CJS deps (e.g. dotenv) call require() of Node builtins. In an
  // ESM bundle esbuild stubs require() to throw; inject a real one so those
  // calls resolve at runtime ("Dynamic require of 'fs' is not supported").
  banner: {
    js: "import { createRequire as __createRequire } from 'module'; const require = __createRequire(import.meta.url);",
  },
});
