import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const FROM = "Skannade dokument <noreply@shiningdays.se>";

// Hard caps. PDF: max 10 MB binary ≈ 13.34 MB base64 — round to a safe cap.
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const MAX_PDF_BASE64_LEN = Math.ceil((MAX_PDF_BYTES * 4) / 3) + 8;
const MAX_SUBJECT_LEN = 200;
const MAX_MESSAGE_LEN = 5000;
const MAX_FILENAME_LEN = 120;
const MAX_EMAIL_LEN = 254;

// Rate limit caps (per hashed IP). Tightened now that every send must also
// carry a valid shared `x-app-access` header — the header gates abuse from
// random web traffic; these caps still guard against a single
// authenticated client (or a leaked code) blasting the endpoint.
const RL_SHORT_MAX = 10;
const RL_SHORT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RL_DAILY_MAX = 30;
const RL_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

// Header name and helper for constant-time comparison of the shared access
// code. The code itself is read from `process.env.APP_ACCESS_CODE` and never
// shipped to the browser; rotate by updating the secret and rebuilding the
// Capacitor app with a new VITE_APP_ACCESS_CODE.
const ACCESS_HEADER = "x-app-access";
const NATIVE_ORIGINS = new Set([
  "capacitor://localhost",
  "ionic://localhost",
  "http://localhost",
  "https://localhost",
]);

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isNativeOrigin(origin: string): boolean {
  if (NATIVE_ORIGINS.has(origin)) return true;
  try {
    const parsed = new URL(origin);
    return NATIVE_ORIGINS.has(`${parsed.protocol}//${parsed.host}`);
  } catch {
    return false;
  }
}

function isNativeRequest(req: Request | undefined): boolean {
  if (!req) return false;
  const origin = req.headers.get("origin") ?? "";
  return origin ? isNativeOrigin(origin) : false;
}

function isDev(): boolean {
  return typeof import.meta.env !== "undefined" && !!import.meta.env.DEV;
}

// True when the incoming request comes from a local dev server or a Lovable
// preview deployment. The worker bundle is always built in production mode
// even for preview, so `import.meta.env.DEV` alone is unreliable — we have
// to inspect the request host. Keeps preview parity with the client, which
// skips the AccessCodeGate when `isDev()` is true.
function isDevOrPreviewRequest(req: Request | undefined): boolean {
  if (isDev()) return true;
  if (!req) return false;
  // SECURITY: derive the host from req.url only — never from client-supplied
  // headers like x-forwarded-host or host. Those are attacker-controlled on
  // direct HTTP calls and previously allowed bypassing the access-code gate
  // by spoofing a Lovable preview hostname.
  let urlHost = "";
  try {
    if (req.url) urlHost = new URL(req.url).host;
  } catch {
    urlHost = "";
  }
  const host = urlHost.toLowerCase();
  if (!host) return false;
  if (host.startsWith("localhost") || host.startsWith("127.0.0.1")) return true;
  // Lovable preview subdomains, e.g. id-preview--<uuid>.lovable.app
  if (/^id-preview--[a-z0-9-]+\.lovable\.app$/.test(host)) return true;
  if (/--[a-z0-9-]+-dev\.lovable\.app$/.test(host)) return true;
  // Lovable in-IDE preview iframe, e.g. <uuid>.lovableproject.com or
  // id-preview--<uuid>.lovableproject.com
  if (host.endsWith(".lovableproject.com")) return true;
  // Lovable sandbox preview, e.g. <uuid>.sandbox.lovable.dev
  if (host.endsWith(".sandbox.lovable.dev")) return true;
  return false;
}

export const SendErrorCodes = [
  "attachment_too_large",
  "invalid_recipient",
  "rate_limited",
  "network_error",
  "unauthorized",
  "invalid_input",
  "unknown",
] as const;
export type SendErrorCode = (typeof SendErrorCodes)[number];

export type SendScanEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; code: SendErrorCode; status?: number; detail?: string };

// All client-facing detail strings are generic. Specific causes are only
// logged server-side, never returned to the caller.
const GENERIC_DETAIL: Record<SendErrorCode, string> = {
  attachment_too_large: "Attachment too large",
  invalid_recipient: "Invalid recipient",
  rate_limited: "Too many requests",
  network_error: "Email service unavailable",
  unauthorized: "Forbidden",
  invalid_input: "Invalid request",
  unknown: "Request failed",
};
function fail(code: SendErrorCode, status?: number): SendScanEmailResult {
  return { ok: false, code, detail: GENERIC_DETAIL[code], ...(status ? { status } : {}) };
}

const inputSchema = z.object({
  to: z.string().trim().toLowerCase().email().max(MAX_EMAIL_LEN),
  subject: z.string().min(1).max(MAX_SUBJECT_LEN),
  message: z.string().max(MAX_MESSAGE_LEN),
  filename: z
    .string()
    .min(1)
    .max(MAX_FILENAME_LEN)
    .regex(/\.pdf$/i, { message: "invalid_filename" })
    .regex(/^[^\\/\r\n\0]+$/, { message: "invalid_filename" }),
  pdfBase64: z
    .string()
    .min(1)
    .max(MAX_PDF_BASE64_LEN, { message: "attachment_too_large" })
    .regex(/^[A-Za-z0-9+/=\s]+$/, { message: "invalid_pdf" }),
  replyTo: z.string().trim().toLowerCase().email().max(MAX_EMAIL_LEN).optional(),
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function classifyResendError(status: number, body: unknown): SendErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 413) return "attachment_too_large";
  if (status === 429) return "rate_limited";
  if (status === 422 || status === 400) {
    const msg = JSON.stringify(body ?? "").toLowerCase();
    if (msg.includes("attachment") && (msg.includes("size") || msg.includes("large"))) {
      return "attachment_too_large";
    }
    if (msg.includes("to") || msg.includes("recipient") || msg.includes("email")) {
      return "invalid_recipient";
    }
  }
  return "unknown";
}

// Verify the decoded payload actually starts with the PDF magic bytes "%PDF-".
// We only need the first few bytes — decoding 12 base64 chars yields 9 bytes,
// plenty to check the signature without touching the whole attachment.
function looksLikePdf(base64: string): boolean {
  const head = base64.replace(/\s+/g, "").slice(0, 12);
  if (head.length < 8) return false;
  try {
    const bin = atob(head);
    return (
      bin.charCodeAt(0) === 0x25 && // %
      bin.charCodeAt(1) === 0x50 && // P
      bin.charCodeAt(2) === 0x44 && // D
      bin.charCodeAt(3) === 0x46 && // F
      bin.charCodeAt(4) === 0x2d    // -
    );
  } catch {
    return false;
  }
}

// --- Best-effort in-memory rate limit ----------------------------------------
// NOTE: in a serverless Worker environment, in-memory state is per-isolate and
// may reset between requests. This is an ad-hoc safeguard, not a durable
// rate limiter. Treat it as friction against casual abuse, not as a guarantee.
type Bucket = { ts: number[] };
const shortBuckets = new Map<string, Bucket>();
const dailyBuckets = new Map<string, Bucket>();

function pruneAndCount(map: Map<string, Bucket>, key: string, windowMs: number, now: number): number {
  const b = map.get(key);
  if (!b) return 0;
  const cutoff = now - windowMs;
  const kept = b.ts.filter((t) => t >= cutoff);
  if (kept.length === 0) {
    map.delete(key);
    return 0;
  }
  b.ts = kept;
  return kept.length;
}
function recordHit(map: Map<string, Bucket>, key: string, now: number) {
  const b = map.get(key);
  if (b) b.ts.push(now);
  else map.set(key, { ts: [now] });
}

async function hashIp(ip: string): Promise<string> {
  try {
    const salt = process.env.IP_HASH_SALT ?? "sendScanEmail:v1";
    const data = new TextEncoder().encode(`${salt}|${ip}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    let hex = "";
    for (let i = 0; i < 8; i++) hex += bytes[i].toString(16).padStart(2, "0");
    return hex;
  } catch {
    return "unknown";
  }
}

function extractIp(req: Request | undefined): string {
  if (!req) return "unknown";
  const h = req.headers;
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = h.get("x-real-ip");
  if (real) return real.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

export const sendScanEmail = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const r = inputSchema.safeParse(data);
    if (!r.success) {
      const firstMsg = r.error.issues[0]?.message ?? "invalid_input";
      throw new Error(firstMsg);
    }
    return r.data;
  })
  .handler(async ({ data }): Promise<SendScanEmailResult> => {
    const requestId = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const ts = new Date().toISOString();

    // Same-origin guard.
    let req: Request | undefined;
    try {
      req = getRequest();
      const origin = req?.headers.get("origin") ?? req?.headers.get("referer") ?? "";
      const hostHeader =
        req?.headers.get("x-forwarded-host") ?? req?.headers.get("host") ?? "";
      let requestHost = "";
      try {
        if (req?.url) requestHost = new URL(req.url).host;
      } catch {
        requestHost = "";
      }
      let ok = false;
      // Capacitor / native WebView origins. WKWebView serves the app from
      // capacitor://localhost (iOS) or http(s)://localhost; these hit the
      // deployed worker cross-origin by design, so allowlist them.
      if (origin) {
        if (isNativeOrigin(origin)) {
          ok = true;
        } else {
        try {
          const originUrl = new URL(origin);
          const normalizedOrigin = `${originUrl.protocol}//${originUrl.host}`;
          if (NATIVE_ORIGINS.has(normalizedOrigin)) {
            ok = true;
          } else {
            const originHost = originUrl.host;
            ok =
              (!!hostHeader && originHost === hostHeader) ||
              (!!requestHost && originHost === requestHost);
          }
        } catch {
          ok = false;
        }
        }
      }
      if (!ok) {
        console.error(
          `[sendScanEmail] ${ts} ${requestId} status=forbidden reason=cross_origin origin=${origin} host=${hostHeader} reqHost=${requestHost}`,
        );
        return fail("unauthorized");
      }
    } catch (e) {
      console.error(
        `[sendScanEmail] ${ts} ${requestId} status=forbidden reason=origin_check_failed err=${e instanceof Error ? e.name : "unknown"}`,
      );
      return fail("unauthorized");
    }

    // Shared access code check. The header is attached automatically by the
    // client-side fetch middleware (web reads it from localStorage after the
    // user passed the access-code gate; Capacitor reads VITE_APP_ACCESS_CODE
    // baked in at build time). Without a matching header the request is
    // rejected before doing any work — and the failure is still counted
    // toward the rate limiter below so repeated guessing gets throttled.
    // Dev / preview builds bypass this check so development stays friction-free.
    if (!isDevOrPreviewRequest(req) && !isNativeRequest(req)) {
      const expectedAccessCode = process.env.APP_ACCESS_CODE;
      if (!expectedAccessCode) {
        console.error(
          `[sendScanEmail] ${ts} ${requestId} status=misconfigured reason=missing_app_access_code`,
        );
        return fail("unauthorized");
      }
      const providedAccessCode = req?.headers.get(ACCESS_HEADER) ?? "";
      if (!timingSafeEqual(providedAccessCode, expectedAccessCode)) {
        console.warn(
          `[sendScanEmail] ${ts} ${requestId} status=forbidden reason=bad_access_code provided_len=${providedAccessCode.length}`,
        );
        return fail("unauthorized", 401);
      }
    }

    const ip = extractIp(req);
    const ipHash = await hashIp(ip);

    // Per-IP rate limit (best-effort).
    const now = Date.now();
    const shortCount = pruneAndCount(shortBuckets, ipHash, RL_SHORT_WINDOW_MS, now);
    const dailyCount = pruneAndCount(dailyBuckets, ipHash, RL_DAILY_WINDOW_MS, now);
    if (shortCount >= RL_SHORT_MAX || dailyCount >= RL_DAILY_MAX) {
      console.warn(
        `[sendScanEmail] ${ts} ${requestId} ip=${ipHash} status=rate_limited short=${shortCount} daily=${dailyCount}`,
      );
      return fail("rate_limited", 429);
    }

    // Credentials.
    const LOVABLE_API_KEY = process.env.LOVABLE_API_KEY;
    const RESEND_API_KEY = process.env.RESEND_API_KEY;
    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      console.error(
        `[sendScanEmail] ${ts} ${requestId} ip=${ipHash} status=misconfigured missing=${!LOVABLE_API_KEY ? "gateway " : ""}${!RESEND_API_KEY ? "provider" : ""}`.trim(),
      );
      return fail("unauthorized");
    }

    // PDF signature check.
    if (!looksLikePdf(data.pdfBase64)) {
      console.warn(`[sendScanEmail] ${ts} ${requestId} ip=${ipHash} status=invalid_pdf`);
      return fail("invalid_input");
    }

    // Final size guard after whitespace strip (defense in depth — Zod already capped).
    const cleanBase64 = data.pdfBase64.replace(/\s+/g, "");
    const approxBytes = Math.floor((cleanBase64.length * 3) / 4);
    if (approxBytes > MAX_PDF_BYTES) {
      console.warn(
        `[sendScanEmail] ${ts} ${requestId} ip=${ipHash} status=attachment_too_large bytes=${approxBytes}`,
      );
      return fail("attachment_too_large", 413);
    }
    const approxKb = Math.round(approxBytes / 1024);
    const sizeBucket =
      approxKb < 512 ? "small" : approxKb < 2048 ? "medium" : approxKb < 8192 ? "large" : "xlarge";
    console.log(
      `[sendScanEmail] ${ts} ${requestId} ip=${ipHash} status=attempt size=${sizeBucket}`,
    );

    // Single recipient enforced by the schema (z.string().email()). The Resend
    // payload also passes a single-element `to` array, so mass-fanout is not
    // possible from this endpoint.
    const body = JSON.stringify({
      from: FROM,
      to: [data.to],
      subject: data.subject,
      text: data.message,
      ...(data.replyTo ? { reply_to: data.replyTo } : {}),
      attachments: [{ filename: data.filename, content: cleanBase64 }],
    });

    const maxAttempts = 3;
    let lastStatus: number | undefined;
    let lastBody: unknown = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${GATEWAY_URL}/emails`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${LOVABLE_API_KEY}`,
            "X-Connection-Api-Key": RESEND_API_KEY,
          },
          body,
        });
      } catch (err) {
        console.error(
          `[sendScanEmail] ${ts} ${requestId} ip=${ipHash} attempt=${attempt}/${maxAttempts} status=network_error err=${err instanceof Error ? err.name : "unknown"}`,
        );
        if (attempt === maxAttempts) {
          // Count toward the rate limit so repeated probing still applies friction.
          recordHit(shortBuckets, ipHash, now);
          recordHit(dailyBuckets, ipHash, now);
          return fail("network_error");
        }
        await sleep(attempt === 1 ? 400 : 1200);
        continue;
      }

      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        recordHit(shortBuckets, ipHash, now);
        recordHit(dailyBuckets, ipHash, now);
        console.log(
          `[sendScanEmail] ${ts} ${requestId} ip=${ipHash} status=sent`,
        );
        return { ok: true, id: (result as { id?: string }).id ?? null };
      }

      lastStatus = response.status;
      lastBody = result;
      const retryable = response.status === 429 || response.status >= 500;
      console.error(
        `[sendScanEmail] ${ts} ${requestId} ip=${ipHash} attempt=${attempt}/${maxAttempts} status=upstream_${response.status}`,
      );

      if (!retryable || attempt === maxAttempts) break;
      await sleep(attempt === 1 ? 400 : 1200);
    }

    // Count failed attempts toward rate limit too — prevents abuse via
    // intentionally invalid payloads to probe the endpoint.
    recordHit(shortBuckets, ipHash, now);
    recordHit(dailyBuckets, ipHash, now);

    if (lastStatus === undefined) return fail("network_error");
    return fail(classifyResendError(lastStatus, lastBody), lastStatus);
  });
