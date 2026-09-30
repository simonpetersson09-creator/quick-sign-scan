import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

export type MonthlyStat = { month: string; sent: number; failed: number };
export type AdminStats =
  | { ok: true; months: MonthlyStat[]; totalSent: number; thisMonthSent: number }
  | { ok: false };

// Per-IP rate limit (best-effort, in-memory) on admin password attempts.
// Mirrors verifyAccessCode: in a serverless Worker this is per-isolate and may
// reset between requests, so treat it as friction against brute force rather
// than a hard guarantee.
const RL_MAX = 5;
const RL_WINDOW_MS = 15 * 60 * 1000;
const buckets = new Map<string, number[]>();

function extractIp(req: Request | undefined): string {
  if (!req) return "unknown";
  const h = req.headers;
  return (
    h.get("cf-connecting-ip")?.trim() ||
    h.get("x-real-ip")?.trim() ||
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

function tooManyAttempts(key: string, now: number): boolean {
  const kept = (buckets.get(key) ?? []).filter((t) => t >= now - RL_WINDOW_MS);
  if (kept.length === 0) buckets.delete(key);
  else buckets.set(key, kept);
  return kept.length >= RL_MAX;
}

function recordAttempt(key: string, now: number) {
  const kept = (buckets.get(key) ?? []).filter((t) => t >= now - RL_WINDOW_MS);
  kept.push(now);
  buckets.set(key, kept);
}

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string }) => ({
    password: String(data?.password ?? "").trim().slice(0, 200),
  }))
  .handler(async ({ data }) => {
    const now = Date.now();
    const ip = extractIp(getRequest());
    if (tooManyAttempts(ip, now)) {
      await new Promise((r) => setTimeout(r, 600));
      return { ok: false as const };
    }
    const { checkAdminPassword, getAdminSession, loadMonthlyStats } = await import("./admin.server");
    if (!checkAdminPassword(data.password)) {
      recordAttempt(ip, now);
      await new Promise((r) => setTimeout(r, 600));
      return { ok: false as const };
    }
    buckets.delete(ip);
    const session = await getAdminSession();
    await session.update({ admin: true });
    return loadMonthlyStats();
  });


export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { getAdminSession } = await import("./admin.server");
  const session = await getAdminSession();
  await session.clear();
  return { ok: true as const };
});

export const adminEmailStats = createServerFn({ method: "GET" }).handler(
  async (): Promise<AdminStats> => {
    const { getAdminSession, loadMonthlyStats } = await import("./admin.server");
    const session = await getAdminSession();
    if (!session.data?.admin) return { ok: false };
    return loadMonthlyStats();
  },
);
