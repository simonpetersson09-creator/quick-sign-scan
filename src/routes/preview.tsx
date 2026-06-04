import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { useT } from "@/lib/i18n";
import { ArrowRight, Plus, RotateCcw, Trash2, ChevronUp, ChevronDown } from "lucide-react";

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
      navigate({ to: "/" });
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

  function movePage(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= pages.length) return;
    const next = [...pages];
    [next[i], next[j]] = [next[j], next[i]];
    const nextActive = activeIndex === i ? j : activeIndex === j ? i : activeIndex;
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

  if (!pages.length) return null;
  const image = pages[activeIndex];

  return (
    <AppShell title={t("previewTitle")} back="/">
      <p className="text-sm text-muted-foreground mt-1 mb-3">
        {pages.length} {pages.length === 1 ? t("pageSingular") : t("pagePlural")} · {t("previewHint")}
      </p>

      <div className="flex items-center justify-center">
        <div
          className="rounded-2xl overflow-hidden shadow-[var(--shadow-card)] border border-border bg-muted/30 p-3"
          style={{ width: "min(78vw, 340px)", aspectRatio: "1 / 1.414" }}
        >
          <img
            src={image}
            alt={t("scannedAlt")}
            className="w-full h-full object-contain bg-white shadow-sm"
          />
        </div>
      </div>

      {pages.length > 0 && (
        <div className="mt-4 flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
          {pages.map((p, i) => (
            <div key={i} className="shrink-0 flex flex-col items-center gap-1">
              <button
                onClick={() => {
                  setActiveIndex(i);
                  scanStore.set({ imageDataUrl: p });
                }}
                className={`relative rounded-md overflow-hidden border-2 transition ${
                  i === activeIndex ? "border-primary" : "border-border"
                } bg-white`}
                style={{ width: 64, aspectRatio: "1 / 1.414" }}
                aria-label={`Sida ${i + 1}`}
              >
                <img src={p} alt="" className="w-full h-full object-contain" />
                <span className="absolute top-0.5 left-0.5 bg-black/65 text-white text-[10px] px-1.5 py-0.5 rounded font-semibold tabular-nums">
                  {i + 1}
                </span>
              </button>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => movePage(i, -1)}
                  disabled={i === 0}
                  className="h-6 w-6 rounded bg-secondary text-secondary-foreground disabled:opacity-30 flex items-center justify-center active:scale-90"
                  aria-label={t("movePageUp")}
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => movePage(i, 1)}
                  disabled={i === pages.length - 1}
                  className="h-6 w-6 rounded bg-secondary text-secondary-foreground disabled:opacity-30 flex items-center justify-center active:scale-90"
                  aria-label={t("movePageDown")}
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => deletePage(i)}
                  className="h-6 w-6 rounded bg-destructive/10 text-destructive flex items-center justify-center active:scale-90"
                  aria-label={t("deletePage")}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
