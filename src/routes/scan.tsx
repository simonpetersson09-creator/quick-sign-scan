import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { Camera, X } from "lucide-react";

type Status = "starting" | "searching" | "hold" | "found" | "capturing" | "error";

export const Route = createFileRoute("/scan")({
  head: () => ({ meta: [{ title: "Skanna dokument" }] }),
  component: ScanPage,
});

function ScanPage() {
  const navigate = useNavigate();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [status, setStatus] = useState<Status>("starting");
  const [error, setError] = useState<string | null>(null);
  const stableTicks = useRef(0);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setStatus("searching");
      } catch (e) {
        console.error(e);
        setError("Kunde inte öppna kameran. Kontrollera att du gett behörighet.");
        setStatus("error");
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Simulated detection loop — escalates through statuses
  useEffect(() => {
    if (status === "error" || status === "capturing") return;
    if (status === "starting") return;
    const id = setInterval(() => {
      stableTicks.current += 1;
      if (stableTicks.current < 3) setStatus("searching");
      else if (stableTicks.current < 6) setStatus("hold");
      else if (stableTicks.current < 9) setStatus("found");
      else {
        setStatus("capturing");
        capture();
      }
    }, 600);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function capture() {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    // A4 portrait aspect 1:1.414 — crop center
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    const targetAR = 1 / 1.414;
    let cropW = vw;
    let cropH = vw / targetAR;
    if (cropH > vh) {
      cropH = vh;
      cropW = vh * targetAR;
    }
    const sx = (vw - cropW) / 2;
    const sy = (vh - cropH) / 2;
    // Upscale to nice quality
    canvas.width = 1240;
    canvas.height = Math.round(1240 / targetAR);
    const ctx = canvas.getContext("2d")!;
    // Enhance: slight contrast/brightness via filter
    ctx.filter = "contrast(1.15) brightness(1.05) saturate(0.95)";
    ctx.drawImage(video, sx, sy, cropW, cropH, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    scanStore.set({ imageDataUrl: dataUrl });
    streamRef.current?.getTracks().forEach((t) => t.stop());
    navigate({ to: "/preview" });
  }

  const statusText: Record<Status, string> = {
    starting: "Startar kamera…",
    searching: "Söker dokument…",
    hold: "Håll stilla",
    found: "Dokument hittat",
    capturing: "Skannar automatiskt…",
    error: "Fel",
  };

  return (
    <div className="fixed inset-0 bg-black text-white flex flex-col">
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-black/30 pointer-events-none" />

      {/* Top bar */}
      <div className="relative pt-safe px-5 flex items-center justify-between">
        <button
          onClick={() => {
            streamRef.current?.getTracks().forEach((t) => t.stop());
            navigate({ to: "/" });
          }}
          className="h-10 w-10 rounded-full bg-black/50 backdrop-blur flex items-center justify-center"
          aria-label="Avbryt"
        >
          <X className="h-5 w-5" />
        </button>
        <div
          className={`px-4 py-2 rounded-full text-[13px] font-medium backdrop-blur transition ${
            status === "found" || status === "capturing"
              ? "bg-success/90 text-success-foreground"
              : "bg-black/50 text-white"
          }`}
        >
          {statusText[status]}
        </div>
        <div className="w-10" />
      </div>

      {/* A4 viewfinder frame */}
      <div className="relative flex-1 flex items-center justify-center px-6">
        <div
          className="relative"
          style={{ width: "min(82vw, 360px)", aspectRatio: "1 / 1.414" }}
        >
          <FrameCorners active={status === "found" || status === "capturing"} />
          {status === "capturing" && (
            <div className="absolute inset-0 bg-white/20 animate-pulse rounded-md" />
          )}
        </div>
      </div>

      {/* Bottom hint / manual capture */}
      <div className="relative pb-safe px-5 pt-4 flex flex-col items-center gap-3">
        {error && (
          <p className="text-center text-sm text-red-200 max-w-xs">{error}</p>
        )}
        <button
          onClick={() => {
            stableTicks.current = 9;
            setStatus("capturing");
            capture();
          }}
          disabled={status === "starting" || status === "error" || status === "capturing"}
          className="h-16 w-16 rounded-full bg-white text-black flex items-center justify-center shadow-lg active:scale-95 disabled:opacity-40"
          aria-label="Fotografera manuellt"
        >
          <Camera className="h-7 w-7" />
        </button>
        <p className="text-xs text-white/70">Fotograferas automatiskt</p>
      </div>
    </div>
  );
}

function FrameCorners({ active }: { active: boolean }) {
  const color = active ? "var(--success)" : "rgba(255,255,255,0.85)";
  const stroke = 3;
  const len = 28;
  return (
    <div className="absolute inset-0 rounded-md transition" style={{ boxShadow: active ? `0 0 0 9999px rgba(0,0,0,0.35), inset 0 0 0 2px ${color}` : `0 0 0 9999px rgba(0,0,0,0.35)` }}>
      {(["tl", "tr", "bl", "br"] as const).map((p) => (
        <span
          key={p}
          className="absolute"
          style={{
            width: len,
            height: len,
            borderColor: color,
            borderStyle: "solid",
            borderTopWidth: p.startsWith("t") ? stroke : 0,
            borderBottomWidth: p.startsWith("b") ? stroke : 0,
            borderLeftWidth: p.endsWith("l") ? stroke : 0,
            borderRightWidth: p.endsWith("r") ? stroke : 0,
            top: p.startsWith("t") ? -1 : "auto",
            bottom: p.startsWith("b") ? -1 : "auto",
            left: p.endsWith("l") ? -1 : "auto",
            right: p.endsWith("r") ? -1 : "auto",
            borderRadius: 6,
            transition: "border-color 200ms",
          }}
        />
      ))}
    </div>
  );
}
