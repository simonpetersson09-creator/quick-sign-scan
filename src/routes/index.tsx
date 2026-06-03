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

        {/* Flaggorna — lodrätt glaspill, total höjd = 48 px */}
        <div className="flex flex-col items-center justify-center gap-1.5 p-1 h-12 rounded-full bg-white/20 backdrop-blur-md border border-white/40 shadow-[var(--shadow-soft)]">
          <button
            type="button"
            aria-label="Svenska"
            className="w-[26px] h-[26px] rounded-full overflow-hidden border-2 border-white ring-2 ring-white/40 shadow-sm transition active:scale-90"
          >
            <svg viewBox="0 0 16 10" preserveAspectRatio="xMidYMid slice" className="w-full h-full scale-150">
              <rect width="16" height="10" fill="#006AA7" />
              <rect x="5" width="2" height="10" fill="#FECC00" />
              <rect y="4" width="16" height="2" fill="#FECC00" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="English"
            className="w-[26px] h-[26px] rounded-full overflow-hidden border-2 border-transparent opacity-60 transition hover:opacity-100 hover:border-white/30 active:scale-90"
          >
            <svg viewBox="0 0 50 30" preserveAspectRatio="xMidYMid slice" className="w-full h-full scale-150">
              <rect width="50" height="30" fill="#012169" />
              <path d="M0,0 L50,30 M50,0 L0,30" stroke="#FFF" strokeWidth="6" />
              <path d="M0,0 L50,30 M50,0 L0,30" stroke="#C8102E" strokeWidth="4" />
              <path d="M25,0 V30 M0,15 H50" stroke="#FFF" strokeWidth="10" />
              <path d="M25,0 V30 M0,15 H50" stroke="#C8102E" strokeWidth="6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
