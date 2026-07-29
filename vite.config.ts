// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

/**
 * TanStack Start's prerender step spins up a Vite preview server whose
 * preview-server-plugin tries to import `dist/server/server.js`. Nitro instead
 * emits its worker entry as `index.mjs` — depending on the Nitro version /
 * preset that lands either in `.output/server/index.mjs` (Nitro's default
 * output dir) or in `dist/server/index.mjs` (Lovable's build config). The
 * filename mismatch makes the prerender request return 500 ("Cannot find
 * module .../dist/server/server.js"), which fails the entire publish build.
 *
 * This shim plugin runs at the end of the SSR build and writes a tiny
 * `server.js` next to both possible Nitro entries that just re-exports it.
 * That's enough for the preview-server-plugin to load the worker handler and
 * serve the prerender request, on either output layout.
 */
function nitroSsrShimPlugin(): Plugin {
  // Candidate locations for Nitro's real entry, relative to the shim file.
  // `.output/server/index.mjs` is Nitro's default; `./index.mjs` covers the
  // case where the build writes the server bundle into `dist/server`.
  const entryCandidates = ["./index.mjs", "../../.output/server/index.mjs"];

  const shimSource = [
    // Re-export Nitro's fetch handler, but:
    //  1. Resolve the entry lazily and try every known output location, so the
    //     shim can be written before Nitro has finished emitting its entry
    //     (ordering differs between machines/CI; a static import would crash
    //     at load time) and works for both `.output/server` and `dist/server`.
    //  2. Stub `env`/`ctx` so accesses like `env.ASSETS` don't throw under
    //     Node — the prerender preview server invokes `fetch(req)` with no
    //     Cloudflare bindings.
    //  3. Re-wrap the incoming Request as a plain WHATWG Request so Nitro's
    //     `augmentReq` can attach `.ip` and friends. srvx's NodeRequest
    //     exposes `ip` as a read-only getter, which otherwise throws
    //     "Cannot set property ip of #<Request>".
    "const stubCtx = { waitUntil() {}, passThroughOnException() {} };",
    `const entryCandidates = ${JSON.stringify(entryCandidates)};`,
    "let handlerPromise;",
    "async function loadHandler() {",
    "  let lastError;",
    "  for (const candidate of entryCandidates) {",
    "    try {",
    "      const mod = await import(candidate);",
    "      return mod.default ?? mod;",
    "    } catch (error) {",
    "      lastError = error;",
    "    }",
    "  }",
    "  throw lastError ?? new Error('Nitro server entry not found');",
    "}",
    "function getHandler() {",
    "  if (!handlerPromise) {",
    "    handlerPromise = loadHandler();",
    "  }",
    "  return handlerPromise;",
    "}",
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
    "  async fetch(request, env, ctx) {",
    "    const handler = await getHandler();",
    "    return handler.fetch(toPlainRequest(request), env ?? {}, ctx ?? stubCtx);",
    "  },",
    "};",
    "",
  ].join("\n");

  const writeShimTo = (...segments: string[]) => {
    const serverDir = join(process.cwd(), ...segments);
    mkdirSync(serverDir, { recursive: true });
    writeFileSync(join(serverDir, "server.js"), shimSource, "utf8");
    // Guarantee the shim is treated as ESM regardless of what the sibling
    // package.json ends up containing (Nitro writes it without "type": "module").
    const pkgPath = join(serverDir, "package.json");
    if (!existsSync(pkgPath)) {
      writeFileSync(pkgPath, JSON.stringify({ type: "module" }, null, 2), "utf8");
    }
  };

  const writeShim = () => {
    try {
      // Write the shim for both possible Nitro output layouts. `.output` is
      // only touched when Nitro actually emitted there, so we never leave a
      // stray directory behind on the `dist/server` layout.
      writeShimTo("dist", "server");
      if (existsSync(join(process.cwd(), ".output", "server"))) {
        writeShimTo(".output", "server");
      }
    } catch {
      /* ignore — the prerender will surface a clearer error if needed */
    }
  };

  return {
    name: "lovable:nitro-ssr-shim",
    apply: "build",
    writeBundle: { order: "post", handler: writeShim },
    closeBundle: { order: "post", handler: writeShim },
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
    server: { entry: "./server.ts" },
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
