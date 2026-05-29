import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { loadSettings, saveSettings } from "@/lib/settings";
import { RotateCcw } from "lucide-react";

export const Route = createFileRoute("/sign")({
  head: () => ({ meta: [{ title: "Signera" }] }),
  component: SignPage,
});

function SignPage() {
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [useSaved, setUseSaved] = useState(false);
  const settings = loadSettings();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineWidth = 2.5;
  }, []);

  function getPoint(e: React.PointerEvent) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = getPoint(e);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const p = getPoint(e);
    ctx.beginPath();
    ctx.moveTo(last.current!.x, last.current!.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!hasInk) setHasInk(true);
  }
  function end() {
    drawing.current = false;
    last.current = null;
  }

  function clear() {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  }

  function done(saveAsDefault: boolean) {
    const dataUrl = useSaved && settings.savedSignature
      ? settings.savedSignature
      : canvasRef.current!.toDataURL("image/png");
    scanStore.set({ signatureDataUrl: dataUrl });
    if (saveAsDefault && !useSaved) {
      saveSettings({ ...settings, savedSignature: dataUrl });
    }
    navigate({ to: "/review" });
  }

  return (
    <AppShell title="Signera" back="/preview">
      <p className="text-sm text-muted-foreground mt-1">
        Skriv din signatur med fingret i rutan nedan.
      </p>

      {settings.savedSignature && (
        <button
          onClick={() => setUseSaved((v) => !v)}
          className={`mt-4 rounded-2xl border p-3 text-left text-sm transition ${
            useSaved ? "border-primary bg-primary/5" : "border-border bg-card"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">Använd sparad signatur</span>
            <span className={`text-xs ${useSaved ? "text-primary" : "text-muted-foreground"}`}>
              {useSaved ? "Vald" : "Tryck för att välja"}
            </span>
          </div>
          <img src={settings.savedSignature} alt="" className="h-12 mt-2 object-contain" />
        </button>
      )}

      <div className="mt-4 relative rounded-2xl bg-card border border-border shadow-[var(--shadow-soft)] overflow-hidden" style={{ aspectRatio: "16 / 9" }}>
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className={`absolute inset-0 w-full h-full touch-none ${useSaved ? "opacity-40 pointer-events-none" : ""}`}
        />
        {!hasInk && !useSaved && (
          <div className="absolute inset-0 flex items-end justify-center pb-3 pointer-events-none">
            <span className="text-xs text-muted-foreground">Signera här</span>
          </div>
        )}
        <div className="absolute left-4 right-4 bottom-3 border-b border-dashed border-muted-foreground/40 pointer-events-none" />
      </div>

      <div className="mt-2 flex justify-end">
        <button
          onClick={clear}
          disabled={!hasInk || useSaved}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground disabled:opacity-40 px-2 py-1"
        >
          <RotateCcw className="h-4 w-4" /> Rensa
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex flex-col gap-3 pt-5">
        <PrimaryButton onClick={() => done(false)} disabled={!hasInk && !useSaved}>
          Klar — fortsätt
        </PrimaryButton>
        {!useSaved && (
          <PrimaryButton variant="ghost" onClick={() => done(true)} disabled={!hasInk}>
            Klar & spara signaturen
          </PrimaryButton>
        )}
      </div>
    </AppShell>
  );
}
