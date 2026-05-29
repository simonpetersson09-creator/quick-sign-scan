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

      <div className="flex-1 flex flex-col gap-4 justify-center">
        <Link to="/scan" className="block group">
          <div className="rounded-3xl bg-primary text-primary-foreground p-7 shadow-[var(--shadow-card)] transition group-active:scale-[0.99]">
            <ScanLine className="h-8 w-8 mb-6 opacity-90" strokeWidth={1.75} />
            <div className="text-[22px] font-semibold tracking-tight">Skanna dokument</div>
            <div className="text-[14px] opacity-80 mt-1">Kameran öppnas direkt</div>
          </div>
        </Link>

        <Link to="/settings" className="block group">
          <div className="rounded-3xl bg-card text-card-foreground p-7 shadow-[var(--shadow-soft)] border border-border transition group-active:scale-[0.99]">
            <SettingsIcon className="h-7 w-7 mb-6 text-muted-foreground" strokeWidth={1.75} />
            <div className="text-[20px] font-semibold tracking-tight">Inställningar</div>
            <div className="text-[14px] text-muted-foreground mt-1">Mottagare, signatur och meddelande</div>
          </div>
        </Link>
      </div>

      <p className="text-center text-xs text-muted-foreground/80 pb-2 pt-6">
        Dokument sparas aldrig — allt raderas efter sändning.
      </p>
    </div>
  );
}
