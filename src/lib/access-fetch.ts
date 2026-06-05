// Attaches the shared access code as `x-app-access` to every serverFn call.
// Runs in both web and Capacitor builds. The access code is read on each
// request so rotating the value in localStorage (or rebuilding the iOS app
// with a new VITE_APP_ACCESS_CODE) takes effect immediately, no reload
// required.
//
// Only `/_serverFn/*` and `/_server/*` requests get the header — bundled
// static assets and any third-party fetch are untouched.

import { getAccessCode } from "./access-code";

const HEADER_NAME = "x-app-access";
const ATTACH_PREFIXES = ["/_serverFn/", "/_server/"];

function isServerFnUrl(url: string): boolean {
  try {
    const u = new URL(url, "http://placeholder.local");
    return ATTACH_PREFIXES.some((p) => u.pathname.startsWith(p));
  } catch {
    return false;
  }
}

function withAccessHeader(init: RequestInit | undefined): RequestInit {
  const code = getAccessCode();
  if (!code) return init ?? {};
  const headers = new Headers(init?.headers ?? {});
  // Don't overwrite a header that was set explicitly by the caller.
  if (!headers.has(HEADER_NAME)) headers.set(HEADER_NAME, code);
  return { ...(init ?? {}), headers };
}

let installed = false;

export function installAccessCodeFetch() {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      let targetUrl = "";
      if (typeof input === "string") targetUrl = input;
      else if (input instanceof URL) targetUrl = input.toString();
      else if (input instanceof Request) targetUrl = input.url;

      if (!isServerFnUrl(targetUrl)) {
        return originalFetch(input as RequestInfo, init);
      }

      const code = getAccessCode();
      if (!code) return originalFetch(input as RequestInfo, init);

      if (input instanceof Request) {
        // Clone the Request with the merged header. `new Request(req, init)`
        // preserves method, body, mode, etc. and overrides only what's in init.
        const headers = new Headers(input.headers);
        if (!headers.has(HEADER_NAME)) headers.set(HEADER_NAME, code);
        return originalFetch(new Request(input, { headers }), init);
      }
      return originalFetch(input as RequestInfo, withAccessHeader(init));
    } catch {
      return originalFetch(input as RequestInfo, init);
    }
  }) as typeof window.fetch;
}
