// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  tanstackStart: {
    router: {
      // Keep routes in the main client bundle. The scan flow stores documents
      // only in memory for privacy, so a stale lazy route chunk during the
      // transition from camera → preview would force a reload and lose the scan.
      autoCodeSplitting: false,
    },
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    server: { entry: "server" },

    // SPA mode → vid build prerendas en lättviktig shell-HTML (utan route-content)
    // som skrivs till dist/client/index.html. Capacitor (WKWebView) laddar den
    // lokalt; klient-routern hydratiserar och tar därefter över helt på enheten.
    // Web-deployen (Cloudflare Worker) använder fortfarande SSR via src/server.ts.
    spa: {
      enabled: true,
      prerender: {
        // Skriv shellen som `index.html` istället för default `_shell.html`
        // så att Capacitor kan ladda den direkt utan extra konfiguration.
        outputPath: "/index",
      },
    },
  },
});
