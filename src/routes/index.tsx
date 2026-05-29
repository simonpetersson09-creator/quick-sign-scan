import { createFileRoute, Link } from "@tanstack/react-router";
import { ScanLine, PenLine, Mail, CheckCircle2, ChevronRight, ChevronDown, Settings as SettingsIcon } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign & Go — Enkelhet" },
      { name: "description", content: "Sign & Go: skanna, signera, skicka. Enkelhet i fyra steg." },
    ],
  }),
  component: Home,
});

const steps = [
  { icon: ScanLine, label: "Skanna" },
  { icon: PenLine, label: "Signera" },
  { icon: Mail, label: "Skicka" },
  { icon: CheckCircle2, label: "Avsluta" },
];

function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background pt-safe pb-safe px-5">
      {/* Header */}
      <div className="pt-10 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-[34px] leading-none font-semibold tracking-tight">
            Sign <span className="text-muted-foreground/60 font-light">&</span> Go
          </h1>
          <p className="text-[13px] text-muted-foreground mt-2 tracking-wide uppercase">
            Enkelhet
          </p>
        </div>
        <Link
          to="/settings"
          aria-label="Inställningar"
          className="h-10 w-10 rounded-full bg-secondary text-muted-foreground inline-flex items-center justify-center hover:bg-muted transition"
        >
          <SettingsIcon className="h-5 w-5" strokeWidth={1.75} />
        </Link>
      </div>

      {/* Center — flow */}
      <div className="flex-1 flex flex-col items-center justify-center py-6">
        <ol className="flex flex-col items-center gap-2">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.label} className="flex flex-col items-center gap-2">
                <div className="flex items-center gap-4">
                  <div className="relative h-16 w-16 rounded-full bg-card border border-border shadow-[var(--shadow-card)] flex items-center justify-center">
                    <span className="absolute -top-1.5 -left-1.5 h-6 w-6 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <Icon className="h-6 w-6 text-primary" strokeWidth={1.75} />
                  </div>
                  <span className="text-[18px] font-medium tracking-tight w-24">
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <ChevronDown
                    className="h-5 w-5 text-muted-foreground/50 -ml-28"
                    strokeWidth={2}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* CTA */}
      <div className="grid grid-cols-2 gap-3 pb-4">
        <Link to="/scan" className="block group">
          <div className="rounded-2xl bg-primary text-primary-foreground p-4 shadow-[var(--shadow-card)] transition group-active:scale-[0.99] h-full">
            <ScanLine className="h-5 w-5 mb-3 opacity-90" strokeWidth={1.75} />
            <div className="text-[15px] font-semibold tracking-tight">Skanna dokument</div>
            <div className="text-[12px] opacity-80 mt-0.5">Kameran öppnas direkt</div>
          </div>
        </Link>

        <Link to="/settings" className="block group">
          <div className="rounded-2xl bg-card text-card-foreground p-4 shadow-[var(--shadow-soft)] border border-border transition group-active:scale-[0.99] h-full">
            <SettingsIcon className="h-5 w-5 mb-3 text-muted-foreground" strokeWidth={1.75} />
            <div className="text-[15px] font-semibold tracking-tight">Inställningar</div>
            <div className="text-[12px] text-muted-foreground mt-0.5">Mottagare och signatur</div>
          </div>
        </Link>
      </div>
    </div>
  );
}
