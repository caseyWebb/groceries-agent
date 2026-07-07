// The member SPA's build/dev config (member-app-shell). Builds into the Worker's merged
// static-assets root (packages/worker/assets/) with hashed, immutable chunk names; dev
// serves with HMR and proxies /api to the local Worker (`aubr dev:app` runs both).
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { VitePWA } from "vite-plugin-pwa";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// The Worker's assets root — shared with the admin bundle (assets/admin/), which this
// build must never disturb. Gitignored; a build artifact on both sides.
const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../worker/assets");

/** Clean ONLY the app's own outputs (everything in the assets root EXCEPT `admin/`,
 *  which is the admin builder's subtree) so build order never matters. `emptyOutDir`
 *  stays false — Vite must not wipe the sibling subtree. */
function cleanAppOutputs(): Plugin {
  return {
    name: "clean-app-outputs",
    apply: "build",
    buildStart() {
      if (!existsSync(outDir)) return;
      for (const entry of readdirSync(outDir)) {
        if (entry === "admin") continue;
        rmSync(path.join(outDir, entry), { recursive: true, force: true });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    cleanAppOutputs(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    VitePWA({
      // Prompt-to-reload posture (plan §11.3): no auto-activate under a member's feet.
      // The update-prompt UX and the offline persistence layers are P5; this scaffolds
      // the installable shell (manifest + shell precache) so P5 only adds layers.
      registerType: "prompt",
      manifest: {
        name: "Cookbook",
        short_name: "Cookbook",
        description: "The grocery agent's member app",
        start_url: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#f4a259",
        icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        // Precache the app shell ONLY — never the admin bundle sharing this assets root.
        globIgnores: ["admin/**"],
        // The SPA fallback must never shadow a Worker-owned path client-side either:
        // mirror wrangler.jsonc's run_worker_first enumeration (member-app-shell).
        navigateFallback: "index.html",
        navigateFallbackDenylist: [
          /^\/(mcp|api|admin|oauth|authorize|token|register|satellite|cookbook|health|source|\.well-known)(\/|$|\.)/,
        ],
      },
    }),
  ],
  build: {
    outDir,
    emptyOutDir: false,
  },
  server: {
    // HMR dev against the real Worker: cookies flow because the proxy is same-origin
    // from the browser's view (design Decision 14).
    proxy: { "/api": "http://127.0.0.1:8787" },
  },
});
