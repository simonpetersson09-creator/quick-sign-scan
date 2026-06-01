import { createFileRoute, Link } from "@tanstack/react-router";
import { ScanLine, PenLine, Mail, CheckCircle2, ChevronDown, Settings as SettingsIcon, ArrowDown } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign & Go" },
      { name: "description", content: "Sign & Go: skanna, signera, skicka." },
    ],
  }),
  component: Home,
});

const steps = [
  { icon: ScanLine, label: "Skanna" },
  { icon: PenLine, label: "Signera" },
  { icon: Mail, label: "Skicka" },
  { icon: CheckCircle2, label: "Färdig" },
];

function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background pt-safe pb-safe px-5">
      {/* Header */}
      <div className="pt-10 pb-6 flex items-center justify-center">
        <h1 className="text-[34px] leading-none font-semibold tracking-tight">
          Sign <span className="text-muted-foreground/60 font-light">&</span> Go
        </h1>
      </div>

      {/* Center — flow */}
      <div className="flex-1 flex flex-col items-center justify-center py-6">
        <p className="text-[13px] text-muted-foreground uppercase tracking-widest mb-6">
          Så här fungerar det
        </p>
        <ol className="flex flex-col items-center gap-1">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.label} className="flex flex-col items-center">
                <div className="flex items-center gap-4 py-2">
                  <div className="relative h-14 w-14 rounded-full bg-muted/50 border border-border/60 flex items-center justify-center">
                    <span className="absolute -top-1.5 -left-1.5 h-5 w-5 rounded-full bg-muted-foreground/40 text-background text-[10px] font-semibold flex items-center justify-center">
                      {i + 1}
                    </span>
                    <Icon className="h-5 w-5 text-muted-foreground/70" strokeWidth={1.75} />
                  </div>
                  <span className="text-[16px] font-medium tracking-tight text-muted-foreground w-24">
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <ArrowDown
                    className="h-4 w-4 text-muted-foreground/30 my-0.5"
                    strokeWidth={1.5}
                  />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* CTA */}
      <div className="flex items-center gap-3 pb-4">
        <Link to="/scan" className="flex-1 block group">
          <div className="rounded-xl bg-primary text-primary-foreground py-3 px-4 shadow-[var(--shadow-card)] transition active:scale-[0.98] h-full flex items-center justify-center gap-3">
            <ScanLine className="h-5 w-5 shrink-0 opacity-90" strokeWidth={1.75} />
            <span className="text-[15px] font-semibold tracking-tight">Skanna dokument</span>
          </div>
        </Link>

        <Link to="/settings" className="block group">
          <div className="rounded-xl bg-card text-muted-foreground h-12 w-12 flex items-center justify-center shadow-[var(--shadow-soft)] border border-border transition active:scale-[0.98]">
            <SettingsIcon className="h-5 w-5 shrink-0" strokeWidth={1.75} />
          </div>
        </Link>
      </div>
    </div>
  );
}
