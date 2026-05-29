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
      <div className="flex-1 flex flex-col items-center justify-center">
        <ol className="flex flex-col items-center gap-3 w-full max-w-[220px]">
          {steps.map((s, i) => {
            const Icon = s.icon;
            return (
              <li key={s.label} className="flex flex-col items-center gap-3 w-full">
                <div className="flex items-center gap-4 w-full justify-center">
                  <div className="relative h-16 w-16 rounded-full bg-card border border-border shadow-[var(--shadow-card)] flex items-center justify-center">
                    <Icon className="h-6 w-6 text-primary" strokeWidth={1.75} />
                  </div>
                  <span className="text-[17px] font-medium tracking-tight w-20">
                    {s.label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div className="h-8 w-px bg-gradient-to-b from-border to-transparent -ml-24" />
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* CTA */}
      <div className="pb-6">
        <Link
          to="/scan"
          className="group relative w-full h-16 rounded-2xl bg-primary text-primary-foreground shadow-[var(--shadow-card)] flex items-center justify-center gap-2 text-[17px] font-semibold tracking-tight active:scale-[0.99] transition"
        >
          Börja nu
          <ChevronRight className="h-5 w-5 transition group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
