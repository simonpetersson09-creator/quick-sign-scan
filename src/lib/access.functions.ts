// Server function used by the web access-code gate to validate a code before
// storing it in localStorage. The real protection is in `sendScanEmail`,
// which checks the same header on every send — this endpoint just gives the
// user immediate feedback instead of failing later at send time.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

const MAX_CODE_LEN = 256;

// Per-IP rate limit (best-effort, in-memory). Mirrors the pattern used in
// sendScanEmail. Slows brute-force guessing of APP_ACCESS_CODE — in a
// serverless Worker environment this is per-isolate and may reset between
// requests, so treat it as friction, not a guarantee.
const RL_MAX = 5;
const RL_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
type Bucket = { ts: number[] };
const buckets = new Map<string, Bucket>();

function pruneAndCount(key: string, now: number): number {
  const b = buckets.get(key);
  if (!b) return 0;
  const cutoff = now - RL_WINDOW_MS;
  const kept = b.ts.filter((t) => t >= cutoff);
  if (kept.length === 0) {
    buckets.delete(key);
    return 0;
  }
  b.ts = kept;
  return kept.length;
}
function recordHit(key: string, now: number) {
  const b = buckets.get(key);
  if (b) b.ts.push(now);
  else buckets.set(key, { ts: [now] });
}

async function hashIp(ip: string): Promise<string> {
  try {
    const salt = process.env.IP_HASH_SALT ?? "verifyAccessCode:v1";
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

const inputSchema = z.object({
  code: z.string().min(1).max(MAX_CODE_LEN),
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export const verifyAccessCode = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    const r = inputSchema.safeParse(data);
    if (!r.success) throw new Error("invalid_input");
    return r.data;
  })
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    let req: Request | undefined;
    try {
      req = getRequest();
    } catch {
      req = undefined;
    }
    const ip = extractIp(req);
    const ipHash = await hashIp(ip);
    const now = Date.now();

    // Reject early if this IP has already burned through the window. Apply
    // a small delay to slow automated guessing further.
    const count = pruneAndCount(ipHash, now);
    if (count >= RL_MAX) {
      await sleep(300);
      return { ok: false };
    }

    const expected = process.env.APP_ACCESS_CODE;
    if (!expected) {
      // Count toward the limit so probing a misconfigured deploy still throttles.
      recordHit(ipHash, now);
      return { ok: false };
    }

    const ok = timingSafeEqual(data.code, expected);
    if (!ok) {
      // Only failures count toward the limit; valid users aren't penalised.
      recordHit(ipHash, now);
      await sleep(300);
    }
    return { ok };
  });
