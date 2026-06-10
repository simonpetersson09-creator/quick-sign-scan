import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { dataUrlToBlob } from "@/lib/pdf";
import { useT } from "@/lib/i18n";
import { requestMotionPermissionFromGesture } from "@/lib/motion-permission";
import {
  ArrowLeft,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Mail,
  PenLine,
} from "lucide-react";

export const Route = createFileRoute("/review")({
  head: () => ({ meta: [{ title: "Granska PDF" }] }),
  component: ReviewPage,
  errorComponent: ReviewErrorComponent,
});

function ReviewErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error("[review] route error", error);
  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-6">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold text-foreground">Något gick fel på granska-sidan</h1>
        <p className="mt-2 text-xs text-muted-foreground break-words whitespace-pre-wrap">
          {error?.message || String(error)}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => reset()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Försök igen
          </button>
          <a
            href="/place"
            className="rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground"
          >
            Tillbaka till placera
          </a>
        </div>
      </div>
    </div>
  );
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

function ReviewPage() {
  const navigate = useNavigate();
  const t = useT();
  const [ready, setReady] = useState(false);
  const [sizeBytes, setSizeBytes] = useState<number | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [pageIdx, setPageIdx] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Natural aspect ratio (w/h) of the current page — drives the exact
  // contain-box size so the signature overlay maps 1:1 onto the image.
  const [imgRatio, setImgRatio] = useState(0.707);
  const [approved, setApproved] = useState(false);
  const [sigPos, setSigPos] = useState<{ x: number; y: number } | null>(null);
  const [sigDataUrl, setSigDataUrl] = useState<string | null>(null);
  const [sigPageIndex, setSigPageIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const signed = !!sigDataUrl;

  useEffect(() => {
    let cancelled = false;

    function adopt(allPages: string[], activeUrl: string | null, sig: { dataUrl: string | null; pos: { x: number; y: number } | null; pageIndex: number | null }) {
      setPages(allPages);
      // Signature renders on the page the user picked in /place. If we
      // don't have that index (legacy session), fall back to last page
      // to match the previous behavior.
      const lookup = activeUrl ? allPages.indexOf(activeUrl) : -1;
      const fallbackIdx = lookup >= 0 ? lookup : allPages.length - 1;
      const sigPageIdx =
        sig.pageIndex != null && sig.pageIndex >= 0 && sig.pageIndex < allPages.length
          ? sig.pageIndex
          : allPages.length - 1;
      const idx = sig.dataUrl ? sigPageIdx : fallbackIdx;
      setPageIdx(idx);
      setSigDataUrl(sig.dataUrl);
      setSigPageIndex(sig.dataUrl ? sigPageIdx : null);
      let pos = sig.pos;
      if (sig.dataUrl && !pos) {
        pos = { x: 0.5, y: 0.86 };
        scanStore.set({ signaturePosition: pos });
      }
      setSigPos(pos);
      setReady(true);


      try {
        let bytes = 0;
        for (const p of allPages) {
          try {
            bytes += dataUrlToBlob(p).size;
          } catch {
            /* skip non-data-URL pages */
          }
        }
        setSizeBytes(bytes + 4096);
      } catch {
        setSizeBytes(null);
      }
    }

    const s = scanStore.get();
    const sig = { dataUrl: s.signatureDataUrl ?? null, pos: s.signaturePosition ?? null, pageIndex: s.signaturePageIndex ?? null };
    const img = s.imageDataUrl;
    const allPages = s.pages.length > 0 ? s.pages : img ? [img] : [];
    if (allPages.length > 0) {
      adopt(allPages, img, sig);
      return;
    }

    // In-memory store empty (HMR reload, route-chunk reload, BFCache). Recover
    // from the same-tab preview handoff before bouncing to scan — otherwise
    // pressing "Klar" on /sign can drop the user back to the camera. The
    // handoff also carries the signature, so restore it into the store too.
    function adoptHandoff(h: { pages: string[]; activeIndex: number; signatureDataUrl: string | null; signaturePosition: { x: number; y: number } | null }) {
      const active = h.pages[Math.max(0, Math.min(h.pages.length - 1, h.activeIndex))];
      const recoveredSig = {
        dataUrl: sig.dataUrl ?? h.signatureDataUrl,
        pos: sig.pos ?? h.signaturePosition,
        pageIndex: sig.pageIndex,
      };
      scanStore.set({
        pages: h.pages,
        imageDataUrl: active,
        signatureDataUrl: recoveredSig.dataUrl,
        signaturePosition: recoveredSig.pos,
      });
      adopt(h.pages, active, recoveredSig);
    }

    const sync = scanStore.readPreviewHandoff();
    if (sync?.pages.length) {
      adoptHandoff(sync);
      return;
    }

    void scanStore.readPreviewHandoffAsync().then((handoff) => {
      if (cancelled) return;
      if (handoff?.pages.length) {
        adoptHandoff(handoff);
        return;
      }
      navigate({ to: "/scan", replace: true });
    });

    return () => {
      cancelled = true;
    };
  }, [navigate]);


  // Diagnostics — logs PDF/page dimensions, viewport, initial scale, scroll pos.
  useEffect(() => {
    if (!pages.length) return;
    const img = imgRef.current;
    const rect = containerRef.current?.getBoundingClientRect();
    const log = () => {
      // eslint-disable-next-line no-console
      console.log("[review] preview diagnostics", {
        pageCount: pages.length,
        pageIdx,
        pageNatural: img ? { w: img.naturalWidth, h: img.naturalHeight } : null,
        container: rect ? { w: rect.width, h: rect.height } : null,
        viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
        initialScale: zoom,
        pan,
        scroll: { x: window.scrollX, y: window.scrollY },
      });
    };
    if (img && !img.complete) {
      img.addEventListener("load", log, { once: true });
    } else {
      log();
    }
  }, [pages, pageIdx, zoom, pan]);

  // Reset pan/zoom when changing page so user always starts on fit-to-page.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [pageIdx]);

  // NOTE: Previously this effect rebuilt the entire PDF on every signature
  // drag (debounced). For a 10-page scan that's a 4–8 MB base64 allocation
  // per drag-tick — visible as lag and GC pauses. The signature is now a
  // pure CSS overlay during review; the final PDF is built once at send
  // time in send.tsx, picking up `signaturePosition` from scanStore. We
  // still persist the position on drag release (see onSigUp) so send.tsx
  // reads the latest value.



  function clampPan(nx: number, ny: number, z: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: nx, y: ny };
    const maxX = (rect.width * (z - 1)) / 2;
    const maxY = (rect.height * (z - 1)) / 2;
    return {
      x: Math.max(-maxX, Math.min(maxX, nx)),
      y: Math.max(-maxY, Math.min(maxY, ny)),
    };
  }

  // ---- Pointer / pinch handling ----
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureStart = useRef<{
    dist: number;
    zoom: number;
    panX: number;
    panY: number;
    midX: number;
    midY: number;
  } | null>(null);
  const singleStart = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
  } | null>(null);

  // Signature drag handling
  const sigDrag = useRef<{ id: number | null }>({ id: null });
  const [isDraggingSig, setIsDraggingSig] = useState(false);

  function clientToNorm(clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const localX = (clientX - rect.left - cx - pan.x) / zoom + cx;
    const localY = (clientY - rect.top - cy - pan.y) / zoom + cy;
    return {
      x: Math.max(0.03, Math.min(0.97, localX / rect.width)),
      y: Math.max(0.03, Math.min(0.97, localY / rect.height)),
    };
  }

  function onSigDown(e: React.PointerEvent<HTMLDivElement>) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    sigDrag.current.id = e.pointerId;
    setIsDraggingSig(true);
  }
  function onSigMove(e: React.PointerEvent<HTMLDivElement>) {
    if (sigDrag.current.id !== e.pointerId) return;
    e.stopPropagation();
    const p = clientToNorm(e.clientX, e.clientY);
    if (p) setSigPos(p);
  }
  function onSigUp(e: React.PointerEvent<HTMLDivElement>) {
    if (sigDrag.current.id !== e.pointerId) return;
    e.stopPropagation();
    sigDrag.current.id = null;
    setIsDraggingSig(false);
    if (sigPos) scanStore.set({ signaturePosition: sigPos });
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (sigDrag.current.id !== null) return;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const pts = Array.from(pointers.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      gestureStart.current = {
        dist: Math.hypot(dx, dy),
        zoom,
        panX: pan.x,
        panY: pan.y,
        midX: (pts[0].x + pts[1].x) / 2,
        midY: (pts[0].y + pts[1].y) / 2,
      };
      singleStart.current = null;
    } else if (pointers.current.size === 1) {
      singleStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && gestureStart.current) {
      const pts = Array.from(pointers.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy);
      const ratio = dist / gestureStart.current.dist;
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, gestureStart.current.zoom * ratio));
      setZoom(newZoom);
      setPan(clampPan(gestureStart.current.panX, gestureStart.current.panY, newZoom));
    } else if (pointers.current.size === 1 && singleStart.current && zoom > 1) {
      const dx = e.clientX - singleStart.current.x;
      const dy = e.clientY - singleStart.current.y;
      setPan(clampPan(singleStart.current.panX + dx, singleStart.current.panY + dy, zoom));
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gestureStart.current = null;
    if (pointers.current.size === 0) singleStart.current = null;
  }

  function changeZoom(next: number) {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, +next.toFixed(2)));
    setZoom(z);
    setPan((p) => clampPan(p.x, p.y, z));
  }
  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  function proceed() {
    if (!approved || !ready || !pages.length) return;
    // Persist latest signature position before leaving — send.tsx will
    // build the PDF from scanStore state.
    if (sigPos) scanStore.set({ signaturePosition: sigPos });
    navigate({ to: "/send" });
  }

  const isSigPage = sigPageIndex != null ? pageIdx === sigPageIndex : pageIdx === pages.length - 1;
  const currentImg = pages[pageIdx];

  return (
    <AppShell title={t("reviewTitle")} back={signed ? "/sign" : "/place"}>
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
      {/* Status row */}
      <div className="mt-1 mb-3 flex flex-wrap items-center justify-center gap-2">
        <StatusChip tone="success" label={t("documentReady")} />
        <StatusChip
          tone={signed ? "success" : "muted"}
          label={signed ? t("signed") : t("notSigned")}
        />
        <StatusChip
          tone="muted"
          label={`${pages.length} ${pages.length === 1 ? t("pageSingular") : t("pagePlural")}`}
        />
        <StatusChip tone="muted" label={sizeBytes ? formatBytes(sizeBytes) : "…"} />
      </div>

      {/* Page preview — image-based so iOS Safari shows full page at fit-to-page. */}
      <div className="flex flex-col items-center justify-center gap-3">
        <div className="relative flex items-center justify-center shrink-0" style={{ width: "min(94vw, 460px)", height: "var(--doc-box-h)" }}>
        <div
          ref={containerRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className="relative overflow-hidden touch-none select-none p-3 flex items-center justify-center"
          style={{ height: "100%", maxWidth: "min(88vw, 400px)" }}
        >
          <div
            className="relative"
            style={{
              width: `min(calc(min(88vw, 400px) - 1.5rem), calc((var(--doc-box-h) - 1.5rem) * ${imgRatio}))`,
              height: `min(calc(var(--doc-box-h) - 1.5rem), calc((min(88vw, 400px) - 1.5rem) / ${imgRatio}))`,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "center center",
              transition: pointers.current.size === 0 ? "transform 120ms ease" : "none",
            }}
          >
            {currentImg && (
              <img
                ref={imgRef}
                src={currentImg}
                alt={t("scannedAlt")}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (el.naturalWidth && el.naturalHeight) {
                    setImgRatio(el.naturalWidth / el.naturalHeight);
                  }
                }}
                className="absolute inset-0 h-full w-full object-contain pointer-events-none"
                draggable={false}
              />
            )}
            {isSigPage && sigDataUrl && sigPos && (
              <div
                onPointerDown={onSigDown}
                onPointerMove={onSigMove}
                onPointerUp={onSigUp}
                onPointerCancel={onSigUp}
                role="button"
                aria-label="Flytta signatur"
                className={`absolute touch-none select-none transition ${
                  isDraggingSig ? "cursor-grabbing" : "cursor-grab"
                }`}
                style={{
                  left: `${sigPos.x * 100}%`,
                  top: `${sigPos.y * 100}%`,
                  width: "28%",
                  transform: "translate(-50%, -50%)",
                }}
              >
                <img
                  src={sigDataUrl}
                  alt=""
                  className="block w-full h-auto pointer-events-none"
                  draggable={false}
                />
              </div>
            )}
          </div>
        </div>
        </div>


        {pages.length > 1 && (
          <div className="flex items-center gap-2">
            <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card p-1 shadow-[var(--shadow-soft)]">
              <ZoomButton
                onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
                disabled={pageIdx === 0}
                aria-label="Föregående sida"
              >
                <ChevronLeft className="h-4 w-4" />
              </ZoomButton>
              <span className="px-2 text-xs font-medium tabular-nums">
                {pageIdx + 1}/{pages.length}
              </span>
              <ZoomButton
                onClick={() => setPageIdx((i) => Math.min(pages.length - 1, i + 1))}
                disabled={pageIdx === pages.length - 1}
                aria-label="Nästa sida"
              >
                <ChevronRight className="h-4 w-4" />
              </ZoomButton>
            </div>
          </div>
        )}
        {signed && (
          <p className="text-[11px] text-center text-muted-foreground">
            {t("dragSignatureHint")}
          </p>
        )}
      </div>

      {/* Approval + actions */}
      <div className="pt-5 flex flex-col gap-3">
        <label className="flex items-start gap-3 px-1 select-none cursor-pointer">
          <span
            className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition ${
              approved ? "bg-primary border-primary" : "border-border bg-card"
            }`}
          >
            {approved && <Check className="h-3.5 w-3.5 text-primary-foreground" />}
          </span>
          <input
            type="checkbox"
            className="sr-only"
            checked={approved}
            onChange={(e) => setApproved(e.target.checked)}
          />
          <span className="text-sm text-foreground/80 leading-snug">{t("approveLabel")}</span>
        </label>

        <PrimaryButton onClick={proceed} disabled={!approved || !ready || !pages.length}>
          <span className="inline-flex items-center justify-center gap-2">
            <Mail className="h-5 w-5" /> {t("continueToEmail")}
          </span>
        </PrimaryButton>

        <div className="grid grid-cols-2 gap-3">
          <PrimaryButton
            variant="secondary"
            onClick={() => navigate({ to: "/place" })}
            className="h-12 text-[15px]"
          >
            <span className="inline-flex items-center justify-center gap-2">
              <PenLine className="h-4 w-4" /> {t("moveSignature")}
            </span>
          </PrimaryButton>
          <PrimaryButton
            variant="secondary"
            onClick={() => {
              requestMotionPermissionFromGesture();
              scanStore.clear("retake from review");
              navigate({ to: "/scan" });
            }}
            className="h-12 text-[15px]"
          >
            <span className="inline-flex items-center justify-center gap-2">
              <Camera className="h-4 w-4" /> {t("retake")}
            </span>
          </PrimaryButton>
        </div>

        <button
          onClick={() => navigate({ to: "/sign" })}
          className="inline-flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition py-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> {t("backToSign")}
        </button>
      </div>
      </div>
    </AppShell>
  );
}

function ZoomButton({
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-foreground/80 hover:bg-secondary disabled:opacity-40 disabled:pointer-events-none transition"
    >
      {children}
    </button>
  );
}

function StatusChip({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "muted";
}) {
  const cls =
    tone === "success"
      ? "bg-success/12 text-success border-success/20"
      : "bg-secondary text-secondary-foreground border-border";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium ${cls}`}
    >
      {tone === "success" && <Check className="h-3 w-3" />}
      {label}
    </span>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
