// Routes serverFn calls from the native Capacitor WebView to the deployed
// worker. In WKWebView the app is served from `capacitor://localhost`, so a
// relative fetch to `/_serverFn/...` has no server to hit. We rewrite only
// those paths to the published worker URL; everything else is untouched.
//
// Web build is a complete no-op — `window.location.protocol` is `https:` (or
// `http:` in local dev), never `capacitor:`, so the original fetch is used as-is.

// Den publicerade worker-URL-en. `project--{id}.lovable.app` returnerar 403
// för det här projektet, så vi pekar direkt på det publicerade hostnamnet.
const NATIVE_API_BASE = "https://quick-sign-scan.lovable.app";

// Only these path prefixes are rewritten. Static assets are bundled into the
// app via `webDir: 'dist'`, so they MUST stay on capacitor://localhost.
const REWRITE_PREFIXES = ["/_serverFn/", "/_server/"];

function shouldRewritePath(pathname: string): boolean {
  return REWRITE_PREFIXES.some((p) => pathname.startsWith(p));
}

function rewriteUrl(url: string): string {
  try {
    const u = new URL(url, "capacitor://localhost");
    if (u.protocol !== "capacitor:" && u.host !== "localhost") return url;
    if (!shouldRewritePath(u.pathname)) return url;
    return NATIVE_API_BASE + u.pathname + u.search;
  } catch {
    return url;
  }
}

let installed = false;

export function installCapacitorFetch() {
  if (installed) return;
  if (typeof window === "undefined") return;
  if (window.location.protocol !== "capacitor:") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      if (typeof input === "string") {
        return originalFetch(rewriteUrl(input), init);
      }
      if (input instanceof URL) {
        return originalFetch(rewriteUrl(input.toString()), init);
      }
      if (input instanceof Request) {
        const newUrl = rewriteUrl(input.url);
        if (newUrl === input.url) return originalFetch(input, init);
        // Request is immutable; clone with the new URL preserving method/body/headers.
        return originalFetch(new Request(newUrl, input), init);
      }
    } catch {
      /* fall through to original */
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof window.fetch;

  // eslint-disable-next-line no-console
  console.info("[capacitor-fetch] installed; serverFn calls routed to", NATIVE_API_BASE);
}
