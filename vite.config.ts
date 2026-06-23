import { defineConfig, PluginOption } from "vite";
import { enterDevPlugin, enterProdPlugin } from 'vite-plugin-enter-dev';
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const plugins = [
    ...enterProdPlugin(),
  ];
  if (mode === 'development') {
    plugins.push(...enterDevPlugin());
  }
  return {
    server: {
      host: "::",
      port: 8080,
      // Same-origin in prod (Elysia serves the SPA + API + WS); in dev, forward
      // the backend endpoints to the local Elysia server on :3000 so client code
      // uses identical same-origin URLs in both environments.
      proxy: {
        "/api": { target: "http://localhost:3000", changeOrigin: true },
        "/ws": { target: "ws://localhost:3000", ws: true },
      },
    },
    plugins: plugins.filter(Boolean) as PluginOption[],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    base: '/',
    build: {
      outDir: 'dist',
      // Pin a modern baseline so esbuild doesn't down-level for ancient targets.
      target: 'es2020',
      rollupOptions: {
        output: {
          // Split the heavy, rarely-changing vendors out of the single ~1.2MB app
          // chunk so three.js (~600KB) and React cache independently and don't sit
          // on the menu's critical path as one monolith.
          manualChunks(id) {
            if (!id.includes("node_modules")) return;
            if (id.includes("/three/") || id.includes("/three-stdlib/"))
              return "vendor-three";
            if (
              /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(
                id,
              )
            )
              return "vendor-react";
          },
        },
      },
    }
  };
});