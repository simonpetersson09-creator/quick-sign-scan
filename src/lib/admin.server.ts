import { useSession } from "@tanstack/react-start/server";
import type { AdminStats, MonthlyStat } from "./admin.functions";

type AdminSessionData = { admin?: boolean };

export function getAdminSession() {
  return useSession<AdminSessionData>({
    password: process.env.SESSION_SECRET!,
    name: "signgo-admin",
    maxAge: 60 * 60 * 8,
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" },
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function checkAdminPassword(input: string): boolean {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) return false;
  return timingSafeEqual(input, expected);
}

export async function loadMonthlyStats(): Promise<AdminStats> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 11, 1);
  since.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabaseAdmin
    .from("email_send_events")
    .select("created_at, status")
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(50000);

  if (error) throw new Error("stats_failed");

  const buckets = new Map<string, MonthlyStat>();
  for (let i = 0; i < 12; i++) {
    const d = new Date(since);
    d.setUTCMonth(since.getUTCMonth() + i, 1);
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    buckets.set(key, { month: key, sent: 0, failed: 0 });
  }

  let totalSent = 0;
  for (const row of data ?? []) {
    const key = String(row.created_at).slice(0, 7);
    const b = buckets.get(key);
    if (!b) continue;
    if (row.status === "sent") {
      b.sent += 1;
      totalSent += 1;
    } else {
      b.failed += 1;
    }
  }

  const now = new Date();
  const thisKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return {
    ok: true,
    months: [...buckets.values()],
    totalSent,
    thisMonthSent: buckets.get(thisKey)?.sent ?? 0,
  };
}
