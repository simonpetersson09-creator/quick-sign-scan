import { createServerFn } from "@tanstack/react-start";
import { useSession } from "@tanstack/react-start/server";

export type MonthlyStat = { month: string; sent: number; failed: number };
export type AdminStats =
  | { ok: true; months: MonthlyStat[]; totalSent: number; thisMonthSent: number }
  | { ok: false };

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string }) => ({
    password: String(data?.password ?? "").slice(0, 200),
  }))
  .handler(async ({ data }) => {
    const { checkAdminPassword, getAdminSession } = await import("./admin.server");
    if (!checkAdminPassword(data.password)) {
      await new Promise((r) => setTimeout(r, 600));
      return { ok: false as const };
    }
    const session = await getAdminSession();
    await session.update({ admin: true });
    return { ok: true as const };
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
