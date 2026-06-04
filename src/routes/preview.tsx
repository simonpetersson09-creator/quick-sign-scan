import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { useT } from "@/lib/i18n";
import { ArrowRight, Plus, RotateCcw, Trash2, ScanLine, ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/preview")({
  head: () => ({ meta: [{ title: "Förhandsgranska" }] }),
  component: PreviewPage,
});

function PreviewPage() {
  const navigate = useNavigate();
  const t = useT();
  const [pages, setPages] = useState<string[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const session = scanStore.get();
    if (!session.pages.length) {
      setPages([]);
      setActiveIndex(0);
      return;
    }
    setPages(session.pages);
    const idx = session.imageDataUrl
      ? Math.max(0, session.pages.indexOf(session.imageDataUrl))
      : session.pages.length - 1;
    setActiveIndex(idx);
  }, [navigate]);

  function commitPages(next: string[], nextActive: number) {
    const safeActive = Math.max(0, Math.min(next.length - 1, nextActive));
    setPages(next);
    setActiveIndex(safeActive);
    scanStore.set({
      pages: next,
      imageDataUrl: next[safeActive] ?? null,
    });
  }

  function deletePage(i: number) {
    const next = pages.filter((_, idx) => idx !== i);
    if (next.length === 0) {
      scanStore.clear();
      navigate({ to: "/" });
      return;
    }
    const nextActive = i <= activeIndex ? Math.max(0, activeIndex - 1) : activeIndex;
    commitPages(next, nextActive);
  }


  function startOver() {
    scanStore.clear();
    navigate({ to: "/" });
  }

  function addPage() {
    navigate({ to: "/scan" });
  }

  function accept() {
    navigate({ to: "/place" });
  }

  if (!pages.length) {
    return (
      <AppShell title={t("previewTitle")} back="/scan">
        <div className="flex flex-1 flex-col items-center justify-center text-center pb-16">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-secondary-foreground">
            <ScanLine className="h-6 w-6" />
          </div>
          <h2 className="text-[18px] font-semibold tracking-tight text-foreground">
            {t("emptyPreviewTitle")}
          </h2>
          <p className="mt-2 max-w-[260px] text-sm leading-6 text-muted-foreground">
            {t("emptyPreviewDesc")}
          </p>
        </div>
        <div className="pb-5">
          <PrimaryButton onClick={addPage}>
            <span className="inline-flex items-center justify-center gap-2">
              <ScanLine className="h-5 w-5" /> {t("scanDocument")}
            </span>
          </PrimaryButton>
        </div>
      </AppShell>
    );
  }
  const image = pages[activeIndex];

  return (
    <AppShell title={t("previewTitle")} back="/scan">
      <p className="text-sm text-muted-foreground mt-1 mb-3">
        {pages.length} {pages.length === 1 ? t("pageSingular") : t("pagePlural")} · {t("previewHint")}
      </p>

      <div className="flex items-center justify-center">
        <div className="relative flex items-center justify-center" style={{ width: "min(92vw, 400px)" }}>
          {pages.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const next = Math.max(0, activeIndex - 1);
                setActiveIndex(next);
                scanStore.set({ imageDataUrl: pages[next] });
              }}
              disabled={activeIndex === 0}
              aria-label={t("prevPage")}
              className="absolute left-0 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-card/90 backdrop-blur border border-border shadow-[var(--shadow-soft)] text-foreground/80 hover:bg-secondary disabled:opacity-30 disabled:pointer-events-none transition"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <div
            className="relative rounded-2xl overflow-hidden shadow-[var(--shadow-card)] border border-border bg-muted/30 p-3"
            style={{ width: "min(78vw, 340px)", aspectRatio: "1 / 1.414" }}
          >
            <img
              src={image}
              alt={t("scannedAlt")}
              className="w-full h-full object-contain bg-white shadow-sm"
            />
            {pages.length > 1 && (
              <span className="absolute top-2 right-2 inline-flex items-center rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-white shadow-sm">
                {activeIndex + 1} / {pages.length}
              </span>
            )}
            <button
              type="button"
              onClick={() => deletePage(activeIndex)}
              aria-label={t("deletePage")}
              className="absolute bottom-2 right-2 inline-flex h-9 w-9 items-center justify-center rounded-full bg-card/90 backdrop-blur border border-border shadow-[var(--shadow-soft)] text-destructive hover:bg-destructive/10 transition"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          {pages.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const next = Math.min(pages.length - 1, activeIndex + 1);
                setActiveIndex(next);
                scanStore.set({ imageDataUrl: pages[next] });
              }}
              disabled={activeIndex === pages.length - 1}
              aria-label={t("nextPage")}
              className="absolute right-0 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-card/90 backdrop-blur border border-border shadow-[var(--shadow-soft)] text-foreground/80 hover:bg-secondary disabled:opacity-30 disabled:pointer-events-none transition"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          )}
        </div>
      </div>


      <div className="flex-1" />

      <div className="flex flex-col gap-3 pt-5">
        <PrimaryButton onClick={accept}>
          <span className="inline-flex items-center justify-center gap-2">
            {t("useDocument")} <ArrowRight className="h-5 w-5" />
          </span>
        </PrimaryButton>
        <div className="grid grid-cols-2 gap-3">
          <PrimaryButton variant="secondary" onClick={addPage} className="h-12 text-[15px]">
            <span className="inline-flex items-center justify-center gap-2">
              <Plus className="h-4 w-4" /> {t("addPage")}
            </span>
          </PrimaryButton>
          <PrimaryButton variant="secondary" onClick={startOver} className="h-12 text-[15px]">
            <span className="inline-flex items-center justify-center gap-2">
              <RotateCcw className="h-4 w-4" /> {t("startOver")}
            </span>
          </PrimaryButton>
        </div>
      </div>
    </AppShell>
  );
}
