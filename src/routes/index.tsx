import { createFileRoute, Link } from "@tanstack/react-router";
import { ScanLine, PenLine, Mail, CheckCircle2, Settings as SettingsIcon, ArrowDown } from "lucide-react";

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
      {/* Center everything vertically */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        {/* Title */}
        <h1 className="text-[32px] leading-none font-semibold tracking-tight text-center">
          Sign <span className="text-muted-foreground/50 font-light">&</span> Go
        </h1>

        {/* Flow */}
        <div className="flex flex-col items-center">
          <p className="text-[12px] text-muted-foreground uppercase tracking-widest mb-5">
            Så här fungerar det
          </p>
          <ol className="flex flex-col items-center gap-0.5">
            {steps.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={s.label} className="flex flex-col items-center">
                  <div className="flex items-center gap-3 py-1.5">
                    <div className="relative h-12 w-12 rounded-full bg-card border border-white/40 shadow-[var(--shadow-soft)] flex items-center justify-center">
                      <span className="absolute -top-1 -left-1 h-4.5 w-4.5 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold flex items-center justify-center ring-2 ring-background">
                        {i + 1}
                      </span>
                      <Icon className="h-[18px] w-[18px] text-primary" strokeWidth={1.75} />
                    </div>
                    <span className="text-[15px] font-medium tracking-tight text-foreground/85 w-20">
                      {s.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <ArrowDown
                      className="h-3.5 w-3.5 text-foreground/25 my-0.5"
                      strokeWidth={1.5}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* CTA */}
      <div className="flex items-center justify-center gap-2 pt-2 pb-4">
        {/* Settings — vänster */}
        <Link to="/settings" className="block group">
          <div className="rounded-xl bg-card text-muted-foreground h-12 w-12 flex items-center justify-center shadow-[var(--shadow-soft)] border border-border transition active:scale-[0.98]">
            <SettingsIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
          </div>
        </Link>

        {/* Skanna — lite bredare, i mitten */}
        <Link to="/scan" className="block group">
          <div className="rounded-xl bg-primary text-primary-foreground h-12 px-6 shadow-[var(--shadow-card)] transition active:scale-[0.98] flex items-center justify-center gap-2.5">
            <ScanLine className="h-[18px] w-[18px] shrink-0 opacity-90" strokeWidth={1.75} />
            <span className="text-[15px] font-semibold tracking-tight whitespace-nowrap">Skanna dokument</span>
          </div>
        </Link>

        {/* Flaggorna — lodrätt, total höjd = 48 px */}
        <div className="flex flex-col h-12 w-12 gap-[2px]">
          <div className="flex-1 rounded-lg overflow-hidden border border-border transition active:scale-[0.98]">
            <svg viewBox="0 0 36 24" className="w-full h-full">
              <rect width="36" height="24" fill="#006AA7" />
              <rect x="11" y="0" width="4" height="24" fill="#FECC00" />
              <rect x="0" y="10" width="36" height="4" fill="#FECC00" />
            </svg>
          </div>
          <div className="flex-1 rounded-lg overflow-hidden border border-border transition active:scale-[0.98]">
            <svg viewBox="0 0 36 24" className="w-full h-full">
              <rect width="36" height="24" fill="#012169" />
              <path d="M0 0 L36 24 M36 0 L0 24" stroke="#FFF" strokeWidth="4.8" />
              <path d="M0 0 L36 24 M36 0 L0 24" stroke="#C8102E" strokeWidth="3.2" />
              <path d="M18 0 V24 M0 12 H36" stroke="#FFF" strokeWidth="8" />
              <path d="M18 0 V24 M0 12 H36" stroke="#C8102E" strokeWidth="4.8" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
