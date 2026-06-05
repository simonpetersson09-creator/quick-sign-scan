#!/usr/bin/env node
// v1.0.1 — capacitor shell generator (sync marker)
/**
 * Generates a static SPA shell at dist/client/index.html so the Capacitor (iOS)
 * build has something to load inside WKWebView.
 *
 * The web/SSR build (Nitro on Cloudflare Workers) does NOT need this file —
 * the server renders HTML on the fly. But Capacitor packages the contents of
 * `webDir` (dist/client) into the native bundle and there is no server, so we
 * need a real index.html with the hashed entry script + CSS injected.
 *
 * We read Vite's client manifest at dist/client/.vite/manifest.json
 * (enabled via vite.config.ts -> environments.client.build.manifest = true)
 * and emit a minimal HTML shell that boots the client bundle. TanStack
 * Router then takes over and renders the route on the client.
 *
 * Safe to run on every `bun run build` — the extra file does not affect the
 * Nitro/Cloudflare deploy bundle.
 */
import { readFile, writeFile, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDir = join(__dirname, "..", "dist", "client");
const manifestPath = join(clientDir, ".vite", "manifest.json");
const outPath = join(clientDir, "index.html");

try {
  await access(manifestPath);
} catch {
  console.warn(
    `[capacitor-shell] No client manifest at ${manifestPath}. Skipping index.html generation.`,
  );
  process.exit(0);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

// Find the client entry. With autoCodeSplitting: false there should be a
// single isEntry chunk that boots the router.
const entries = Object.values(manifest).filter((c) => c && c.isEntry);
if (entries.length === 0) {
  console.error("[capacitor-shell] No entry chunk found in client manifest.");
  process.exit(1);
}

// Prefer the entry that imports the router/root (the largest one) — typically
// the only one — but fall back to the first.
const entry = entries.sort((a, b) => (b.imports?.length ?? 0) - (a.imports?.length ?? 0))[0];

const cssLinks = new Set();
const moduleLinks = new Set();

function collectCss(chunk) {
  for (const css of chunk.css ?? []) cssLinks.add(css);
}
function walk(file, seen = new Set()) {
  if (seen.has(file)) return;
  seen.add(file);
  const chunk = manifest[file];
  if (!chunk) return;
  collectCss(chunk);
  for (const imp of chunk.imports ?? []) {
    const dep = manifest[imp];
    if (dep?.file) moduleLinks.add(dep.file);
    walk(imp, seen);
  }
}
walk(Object.keys(manifest).find((k) => manifest[k] === entry));

const cssTags = [...cssLinks]
  .map((href) => `    <link rel="stylesheet" href="/${href}">`)
  .join("\n");
const preloadTags = [...moduleLinks]
  .map((href) => `    <link rel="modulepreload" href="/${href}">`)
  .join("\n");

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>SSPP Sign & Go</title>
    <meta name="description" content="Scan, sign, and email documents instantly with Sign & Go." />
${cssTags}
${preloadTags}
    <script type="module" src="/${entry.file}"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

await writeFile(outPath, html, "utf8");
console.log(`[capacitor-shell] Wrote ${outPath} (entry: ${entry.file})`);
