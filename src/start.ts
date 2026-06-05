import { createStart, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const NATIVE_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
]);
const CORS_SERVER_PREFIXES = ["/_serverFn/", "/_server/"];

function getAllowedNativeOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  if (NATIVE_ORIGINS.has(origin)) return origin;
  try {
    const parsed = new URL(origin);
    return NATIVE_ORIGINS.has(`${parsed.protocol}//${parsed.host}`) ? origin : null;
  } catch {
    return null;
  }
}

function withNativeCors(response: Response, request: Request, origin: string): Response {
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set(
    "access-control-allow-headers",
    request.headers.get("access-control-request-headers") ??
      "accept, content-type, x-app-access, x-tsr-serverfn, x-requested-with",
  );
  headers.set("access-control-max-age", "86400");
  headers.append("vary", "Origin");
  headers.append("vary", "Access-Control-Request-Headers");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const nativeCorsMiddleware = createMiddleware().server(async ({ request, pathname, next }) => {
  const isServerFunctionRequest = CORS_SERVER_PREFIXES.some((prefix) => pathname.startsWith(prefix));
  const nativeOrigin = isServerFunctionRequest ? getAllowedNativeOrigin(request) : null;
  if (nativeOrigin && request.method === "OPTIONS") {
    return withNativeCors(new Response(null, { status: 204 }), request, nativeOrigin);
  }

  const result = await next();
  if (nativeOrigin) {
    result.response = withNativeCors(result.response, request, nativeOrigin);
  }
  return result;
});

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [nativeCorsMiddleware, errorMiddleware],
}));
