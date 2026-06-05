// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

/**
 * TanStack Start's prerender step spins up a Vite preview server whose
 * preview-server-plugin tries to import `dist/server/server.js`. Lovable's
 * Nitro integration instead emits `dist/server/index.mjs`. The filename
 * mismatch makes the prerender request return 500 ("Cannot find module
 * .../dist/server/server.js"), which fails the entire publish build.
 *
 * This shim plugin runs at the end of the SSR build and writes a tiny
 * `dist/server/server.js` that just re-exports Nitro's `index.mjs`. That's
 * enough for the preview-server-plugin to load the worker handler and serve
 * the prerender request.
 */
function nitroSsrShimPlugin(): Plugin {
  return {
    name: "lovable:nitro-ssr-shim",
    apply: "build",
    closeBundle: {
      order: "post",
      handler() {
        try {
          const serverDir = join(process.cwd(), "dist", "server");
          const nitroEntry = join(serverDir, "index.mjs");
          if (!existsSync(nitroEntry)) return;
          const shimPath = join(serverDir, "server.js");
          writeFileSync(
            shimPath,
            "export { default } from './index.mjs';\n",
            "utf8",
          );
        } catch {
          /* ignore — the prerender will surface a clearer error if needed */
        }
      },
    },
  };
}

export default defineConfig({
  tanstackStart: {
    router: {
      // Keep routes in the main client bundle. The scan flow stores documents
      // only in memory for privacy, so a stale lazy route chunk during the
      // transition from camera → preview would force a reload and lose the scan.
      autoCodeSplitting: false,
    },

    // SPA mode → vid build prerendas en lättviktig shell-HTML (utan route-content)
    // som skrivs till dist/client/index.html. Capacitor (WKWebView) laddar den
    // lokalt; klient-routern hydratiserar och tar därefter över helt på enheten.
    // Web-deployen använder fortfarande SSR via Nitro/Cloudflare.
    spa: {
      enabled: true,
      prerender: {
        // Skriv shellen som `index.html` istället för default `_shell.html`
        // så att Capacitor kan ladda den direkt utan extra konfiguration.
        outputPath: "/index",
      },
    },
  },
  vite: {
    plugins: [nitroSsrShimPlugin()],
  },
});
