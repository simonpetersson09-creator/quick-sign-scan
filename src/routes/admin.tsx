import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Lock, LogOut, Mail } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { adminEmailStats, adminLogin, adminLogout, type MonthlyStat } from "@/lib/admin.functions";

// The admin view is web-only: it must never be reachable inside the native
// (Capacitor/iOS) app shell, so it redirects home there.
function isNativeApp(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.location.protocol === "capacitor:" ||
    Boolean((window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.())
  );
}

export const Route = createFileRoute("/admin")({
  ssr: false,
  beforeLoad: () => {
    if (isNativeApp()) throw redirect({ to: "/" });
  },
  head: () => ({
    meta: [
      { title: "Admin – e-poststatistik | Sign & Go" },
      { name: "description", content: "Intern adminvy med antal skickade dokument per månad i Sign & Go." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Admin – e-poststatistik | Sign & Go" },
      { property: "og:description", content: "Intern adminvy med antal skickade dokument per månad." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminPage,
});

const MONTH_NAMES = [
  "jan", "feb", "mar", "apr", "maj", "jun",
  "jul", "aug", "sep", "okt", "nov", "dec",
];

function monthLabel(key: string) {
  const [y, m] = key.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y.slice(2)}`;
}

function AdminPage() {
  const login = useServerFn(adminLogin);
  const logout = useServerFn(adminLogout);
  const stats = useServerFn(adminEmailStats);

  const [checking, setChecking] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [months, setMonths] = useState<MonthlyStat[]>([]);
  const [totalSent, setTotalSent] = useState(0);
  const [thisMonthSent, setThisMonthSent] = useState(0);

  async function refresh() {
    const r = await stats({});
    if (r.ok) {
      setMonths(r.months);
      setTotalSent(r.totalSent);
      setThisMonthSent(r.thisMonthSent);
      setAuthed(true);
    } else {
      setAuthed(false);
    }
  }

  useEffect(() => {
    refresh()
      .catch(() => setAuthed(false))
      .finally(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const r = await login({ data: { password } });
      if (!r.ok) setError("Fel lösenord");
      else {
        setPassword("");
        await refresh();
      }
    } catch {
      setError("Något gick fel");
    } finally {
      setBusy(false);
    }
  }

  async function onLogout() {
    await logout({});
    setAuthed(false);
    setMonths([]);
  }

  const max = Math.max(1, ...months.map((m) => m.sent));

  return (
    <AppShell title="Admin" back="/" mainClassName="overflow-y-auto overscroll-contain">
      {checking ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : !authed ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-3 pt-6 max-w-sm w-full mx-auto">
          <div className="flex items-center gap-2 text-muted-foreground text-[13px]">
            <Lock className="h-4 w-4" />
            <span>Ange adminlösenord</span>
          </div>
          <input
            type="password"
            value={password}
            autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 rounded-xl bg-card border border-border px-4 text-[15px] outline-none focus:border-primary"
            placeholder="Lösenord"
          />
          {error && <p className="text-[12px] text-destructive">{error}</p>}
          <PrimaryButton type="submit" disabled={busy || password.length === 0}>
            {busy ? "Loggar in…" : "Logga in"}
          </PrimaryButton>
        </form>
      ) : (
        <div className="flex flex-col gap-4 pt-2 pb-8">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-card border border-border p-4">
              <div className="text-[12px] text-muted-foreground">Denna månad</div>
              <div className="text-[24px] font-semibold tracking-tight">{thisMonthSent}</div>
            </div>
            <div className="rounded-2xl bg-card border border-border p-4">
              <div className="text-[12px] text-muted-foreground">Senaste 12 mån</div>
              <div className="text-[24px] font-semibold tracking-tight">{totalSent}</div>
            </div>
          </div>

          <div className="rounded-2xl bg-card border border-border p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
              <Mail className="h-4 w-4 text-primary" />
              <span>Skickade mail per månad</span>
            </div>
            {months.map((m) => (
              <div key={m.month} className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-[12px] text-muted-foreground">
                  {monthLabel(m.month)}
                </span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(m.sent / max) * 100}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right text-[12px] tabular-nums">
                  {m.sent}
                  {m.failed > 0 && (
                    <span className="text-destructive"> /{m.failed}</span>
                  )}
                </span>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground pt-1">
              Siffran efter snedstrecket visar misslyckade utskick.
            </p>
          </div>

          <button
            type="button"
            onClick={onLogout}
            className="rounded-xl bg-background text-foreground border border-border h-10 px-4 transition active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <LogOut className="h-4 w-4" />
            <span className="text-[13px] font-medium">Logga ut</span>
          </button>
        </div>
      )}
    </AppShell>
  );
}
