import { createFileRoute, Link } from "@tanstack/react-router";
import { ScanLine, Settings as SettingsIcon } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Skanna & Signera" },
      { name: "description", content: "Skanna A4-dokument, signera och skicka via e-post — enkelt och säkert." },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <div className="min-h-screen flex flex-col bg-background pt-safe pb-safe px-5">
      <div className="pt-10 pb-8">
        <p className="text-sm text-muted-foreground">Välkommen</p>
        <h1 className="text-[34px] leading-tight font-semibold tracking-tight mt-1">
          Skanna & signera
        </h1>
        <p className="text-muted-foreground mt-2 text-[15px] leading-relaxed">
          Fota ett A4-dokument, signera om det behövs och skicka det som PDF.
        </p>
      </div>

      <div className="flex-1" />

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

      <p className="text-center text-xs text-muted-foreground/80 pb-2">
        Dokument sparas aldrig — allt raderas efter sändning.
      </p>
    </div>
  );
}
