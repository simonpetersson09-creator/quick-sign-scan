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
            // Re-export Nitro's fetch handler, but:
            //  1. Stub `env`/`ctx` so accesses like `env.ASSETS` don't throw
            //     under Node — the prerender preview server invokes
            //     `fetch(req)` with no Cloudflare bindings.
            //  2. Re-wrap the incoming Request as a plain WHATWG Request so
            //     Nitro's `augmentReq` can attach `.ip` and friends. srvx's
            //     NodeRequest exposes `ip` as a read-only getter, which
            //     otherwise throws "Cannot set property ip of #<Request>".
            [
              "import handler from './index.mjs';",
              "const stubCtx = { waitUntil() {}, passThroughOnException() {} };",
              "function toPlainRequest(request) {",
              "  const init = {",
              "    method: request.method,",
              "    headers: request.headers,",
              "    redirect: request.redirect,",
              "  };",
              "  if (request.method !== 'GET' && request.method !== 'HEAD') {",
              "    init.body = request.body;",
              "    init.duplex = 'half';",
              "  }",
              "  return new Request(request.url, init);",
              "}",
              "export default {",
              "  fetch: (request, env, ctx) =>",
              "    handler.fetch(toPlainRequest(request), env ?? {}, ctx ?? stubCtx),",
              "};",
              "",
            ].join("\n"),
            "utf8",
          );


        } catch {
          /* ignore — the prerender will surface a clearer error if needed */
        }
      },
    },
  };
}

function stableServerFunctionId({ filename, functionName }: { filename: string; functionName: string }) {
  const normalized = filename.replace(/\\/g, "/");
  if ((normalized === "src/lib/email.functions.ts" || normalized.endsWith("/src/lib/email.functions.ts")) && functionName === "sendScanEmail_createServerFn_handler") {
    // Keep the original production hash so already-installed TestFlight builds
    // can keep calling the published backend without requiring a new iOS build.
    return "f0a03244e848d5e4fe61397dc97c14ecd7666dd23a1ff675a353ae01048503d0";
  }
  if ((normalized === "src/lib/access.functions.ts" || normalized.endsWith("/src/lib/access.functions.ts")) && functionName === "verifyAccessCode_createServerFn_handler") {
    return "src_lib_access_functions_ts--verifyAccessCode_createServerFn_handler";
  }
  return undefined;
}

export default defineConfig({
  tanstackStart: {
    // Route Cloudflare Worker requests through src/server.ts so the native
    // CORS/preflight wrapper actually runs. Without this, TanStack's default
    // server-entry is used and OPTIONS /_serverFn/* returns 405.
    server: { entry: "server" },
    serverFns: {
      // Keep these IDs stable so an already-installed Capacitor build can call
      // the newly published backend without requiring a new TestFlight build.
      generateFunctionId: stableServerFunctionId,
    },
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
