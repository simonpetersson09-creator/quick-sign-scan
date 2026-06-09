import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore, type ScanDebugStage } from "@/lib/scanStore";
import { useT } from "@/lib/i18n";
import { applyFilter, type FilterMode } from "@/lib/imageFilters";
import {
  analyzeDocumentQuality,
  type QualityIssue,
  type QualityMode,
  type QualityReport,
} from "@/lib/quality";
import { AlertTriangle } from "lucide-react";
import {
  ArrowRight,
  Plus,
  RotateCcw,
  Trash2,
  ScanLine,
  ChevronLeft,
  ChevronRight,
  Palette,
  Contrast,
  Circle,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/preview")({
  head: () => ({ meta: [{ title: "Förhandsgranska" }] }),
  component: PreviewPage,
});

function PreviewPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();
  const navState = location.state as typeof location.state & {
    scanPages?: unknown;
    scanActiveIndex?: unknown;
  };
  const handedOffPages = useMemo(
    () =>
      Array.isArray(navState.scanPages)
        ? navState.scanPages.filter(
            (page): page is string => typeof page === "string" && page.startsWith("data:image/"),
          )
        : [],
    [navState.scanPages],
  );
  const consumedHandoffRef = useRef<{
    read: boolean;
    value: ReturnType<typeof scanStore.readPreviewHandoff>;
  }>({ read: false, value: null });
  if (!consumedHandoffRef.current.read) {
    consumedHandoffRef.current = { read: true, value: scanStore.readPreviewHandoff() };
  }
  const recoveredPages = useMemo(
    () => consumedHandoffRef.current.value?.pages ?? [],
    [],
  );
  const recoveredActiveIndex = consumedHandoffRef.current.value?.activeIndex;
  // Initialize synchronously from the in-memory store so we don't flash the
  // empty state when pages are already present (e.g. just-finished scan).
  const [pages, setPages] = useState<string[]>(() => {
    const list = scanStore.getPages();
    return list.length ? list : handedOffPages.length ? handedOffPages : recoveredPages;
  });
  const [activeIndex, setActiveIndex] = useState<number>(() => {
    const s = scanStore.get();
    const list = scanStore.getPages().length
      ? scanStore.getPages()
      : handedOffPages.length
        ? handedOffPages
        : recoveredPages;
    if (!list.length) return 0;
    if (typeof navState.scanActiveIndex === "number") {
      return Math.max(0, Math.min(list.length - 1, navState.scanActiveIndex));
    }
    if (typeof recoveredActiveIndex === "number") {
      return Math.max(0, Math.min(list.length - 1, recoveredActiveIndex));
    }
    return s.imageDataUrl ? Math.max(0, list.indexOf(s.imageDataUrl)) : list.length - 1;
  });
  // Default to the original color image. This is the safest preservation mode:
  // grayscale/BW are optional presentation filters, but color keeps faint ink,
  // stamps and pale printed text from being reduced or washed out by default.
  const [filterMode, setFilterMode] = useState<FilterMode>("color");
  // Cache filtered results so flipping pages stays instant: key = `${index}|${mode}`
  const filterCache = useRef<Map<string, string>>(new Map());
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);
  const [debugStages, setDebugStages] = useState<ScanDebugStage[] | null>(
    () => scanStore.get().debugStages,
  );
  const [debugZoom, setDebugZoom] = useState<ScanDebugStage | null>(null);
  const [qualityByKey, setQualityByKey] = useState<Record<string, QualityReport>>({});
  const [dismissedQuality, setDismissedQuality] = useState<Record<string, boolean>>({});
  const handoffRecoveredRef = useRef(false);

  useEffect(() => {
    const fallbackPages = handedOffPages.length ? handedOffPages : recoveredPages;
    const fallbackActiveIndex =
      typeof navState.scanActiveIndex === "number"
        ? navState.scanActiveIndex
        : typeof recoveredActiveIndex === "number"
          ? recoveredActiveIndex
          : fallbackPages.length - 1;
    const list = scanStore.getPages().length ? scanStore.getPages() : fallbackPages;
    if (fallbackPages.length && !scanStore.getPages().length) {
      const safeActive = Math.max(0, Math.min(fallbackPages.length - 1, fallbackActiveIndex));
      scanStore.set({
        pages: fallbackPages,
        imageDataUrl: fallbackPages[safeActive],
      });
      handoffRecoveredRef.current = true;
      window.history.replaceState(
        { ...window.history.state, scanPages: undefined, scanActiveIndex: undefined },
        "",
      );
    } else if (scanStore.getPages().length) {
      handoffRecoveredRef.current = true;
    }
    const first = list[0];
    console.info("[preview] mounted with pages count", {
      pages: list.length,
      firstPageExists: Boolean(first),
      firstImageSrcValid: Boolean(first?.startsWith("data:image/") || first?.startsWith("blob:")),
      imageDataUrlExists: Boolean(scanStore.get().imageDataUrl),
    });
  }, [handedOffPages, navState.scanActiveIndex, recoveredActiveIndex, recoveredPages]);

  useEffect(() => {
    if (pages.length) return;
    let cancelled = false;
    void scanStore.readPreviewHandoffAsync().then((handoff) => {
      if (cancelled || !handoff?.pages.length || scanStore.getPages().length) return;
      const safeActive = Math.max(0, Math.min(handoff.pages.length - 1, handoff.activeIndex));
      scanStore.set({ pages: handoff.pages, imageDataUrl: handoff.pages[safeActive] });
      setPages(handoff.pages);
      setActiveIndex(safeActive);
      handoffRecoveredRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [pages.length]);

  // Subscribe to store updates so any late mutation (race with navigation,
  // or external change) reflects here.
  useEffect(() => {
    const sync = () => {
      const session = scanStore.get();
      const list = scanStore.getPages();
      setPages((prev) => (list.length ? list : prev.length ? prev : list));
      if (!list.length) {
        return;
      }
      const idx = session.imageDataUrl
        ? Math.max(0, list.indexOf(session.imageDataUrl))
        : list.length - 1;
      setActiveIndex((prev) => (prev >= 0 && prev < list.length ? prev : idx));
      setDebugStages(session.debugStages);
    };
    sync();
    const unsub = scanStore.subscribe(sync);
    return () => {
      unsub();
    };
  }, []);

  const originalImage = pages[activeIndex];

  // Recompute display image when page or filter mode changes. Cached so the
  // user can flip between pages in the same mode without re-running Sauvola.
  useEffect(() => {
    let cancelled = false;
    if (!originalImage) {
      console.info("[preview] image src valid", { valid: false, reason: "missing originalImage" });
      setDisplayUrl(null);
      return;
    }
    console.info("[preview] first page exists", {
      firstPageExists: Boolean(pages[0]),
      currentPageExists: Boolean(originalImage),
      pages: pages.length,
    });
    if (filterMode === "color") {
      console.info("[preview] image src valid", {
        valid: originalImage.startsWith("data:image/") || originalImage.startsWith("blob:"),
        source: originalImage.startsWith("blob:") ? "blob" : "dataUrl",
        bytes: originalImage.length,
      });
      setDisplayUrl(originalImage);
      setFiltering(false);
      return;
    }
    const key = `${activeIndex}|${filterMode}`;
    const cached = filterCache.current.get(key);
    if (cached) {
      setDisplayUrl(cached);
      setFiltering(false);
      return;
    }
    setFiltering(true);
    applyFilter(originalImage, filterMode)
      .then((url) => {
        if (cancelled) return;
        filterCache.current.set(key, url);
        setDisplayUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        setDisplayUrl(originalImage);
      })
      .finally(() => {
        if (!cancelled) setFiltering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [originalImage, activeIndex, filterMode, pages]);

  // Invalidate caches when the underlying pages change (delete, reorder).
  useEffect(() => {
    filterCache.current.clear();
    setQualityByKey({});
    setDismissedQuality({});
  }, [pages]);

  // Run a soft quality check on the currently displayed image (per filter
  // mode). Non-blocking — results render as a banner; user can ignore.
  const qualityKey = `${activeIndex}|${filterMode}`;
  const analysisSource = filterMode === "color" ? originalImage : displayUrl;
  useEffect(() => {
    if (!analysisSource) return;
    if (qualityByKey[qualityKey]) return;
    if (filtering) return;
    let cancelled = false;
    const mode: QualityMode = filterMode;
    void analyzeDocumentQuality(analysisSource, mode)
      .then((report) => {
        if (cancelled) return;
        setQualityByKey((prev) => ({ ...prev, [qualityKey]: report }));
      })
      .catch(() => {
        // Silent — quality check is advisory only.
      });
    return () => {
      cancelled = true;
    };
  }, [analysisSource, qualityKey, qualityByKey, filterMode, filtering]);

  function logPreviewImageLoad(source: string | null | undefined) {
    console.info("[preview] image element load", {
      hasSource: Boolean(source),
      recoveredFromHandoff: handoffRecoveredRef.current,
      pages: pages.length,
    });
  }

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
      scanStore.clear("delete last page in preview");
      navigate({ to: "/" });
      return;
    }
    const nextActive = i <= activeIndex ? Math.max(0, activeIndex - 1) : activeIndex;
    commitPages(next, nextActive);
  }

  function startOver() {
    scanStore.clear("start over from preview");
    navigate({ to: "/" });
  }

  function addPage() {
    navigate({ to: "/scan" });
  }

  async function accept() {
    // If a filter is selected, bake it into all pages before continuing so
    // the signing step and PDF use the filtered version.
    if (filterMode !== "color") {
      setFiltering(true);
      try {
        const filtered = await Promise.all(
          pages.map(async (p, idx) => {
            const key = `${idx}|${filterMode}`;
            const cached = filterCache.current.get(key);
            if (cached) return cached;
            const url = await applyFilter(p, filterMode);
            filterCache.current.set(key, url);
            return url;
          }),
        );
        scanStore.set({
          pages: filtered,
          imageDataUrl: filtered[activeIndex] ?? null,
        });
      } catch {
        // Fallback — proceed with originals on failure.
      } finally {
        setFiltering(false);
      }
    }
    navigate({ to: "/place" });
  }

  const filterButtons: Array<{
    mode: FilterMode;
    label: string;
    Icon: typeof Palette;
  }> = useMemo(
    () => [
      { mode: "color", label: t("filterColor"), Icon: Palette },
      { mode: "gray", label: t("filterGray"), Icon: Circle },
      { mode: "bw", label: t("filterBw"), Icon: Contrast },
    ],
    [t],
  );

  if (!pages.length) {
    return (
      <AppShell title={t("previewTitle")} back="/scan" className="h-dvh overflow-hidden">
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <ScanLine className="h-10 w-10 text-muted-foreground" strokeWidth={1.75} />
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {t("previewEmptyTitle")}
            </h2>
            <p className="max-w-[260px] text-sm text-muted-foreground">
              {t("previewEmptyBody")}
            </p>
          </div>
          <PrimaryButton onClick={() => navigate({ to: "/scan", replace: true })}>
            {t("scanDocument")}
          </PrimaryButton>
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell title={t("previewTitle")} back="/scan" className="h-dvh overflow-hidden">
      <p className="text-sm text-muted-foreground mt-1 mb-3">
        {pages.length} {pages.length === 1 ? t("pageSingular") : t("pagePlural")} ·{" "}
        {t("previewHint")}
      </p>

      <div className="flex-1 min-h-0 flex items-center justify-center">
        <div
          className="relative flex items-center justify-center min-h-0 h-full"
          style={{ width: "min(92vw, 400px)" }}
        >
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
            className="relative rounded-2xl overflow-hidden border border-border bg-muted/30 p-3 flex items-center justify-center"
            style={{ height: "100%", maxWidth: "min(82vw, 360px)" }}
          >
            <img
              src={displayUrl ?? originalImage}
              alt={t("scannedAlt")}
              onLoad={() => logPreviewImageLoad(displayUrl ?? originalImage)}
              onError={() => {
                console.info("[preview] image element failed to load", {
                  hasSource: Boolean(displayUrl ?? originalImage),
                  pages: pages.length,
                });
              }}
              className="block max-h-full max-w-full w-auto h-auto object-contain rounded-lg bg-white"
            />
            {filtering && (
              <div className="absolute inset-3 flex items-center justify-center bg-white/60 backdrop-blur-sm rounded-xl">
                <Loader2 className="h-6 w-6 animate-spin text-foreground/70" />
              </div>
            )}
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

      <div className="mt-4 flex items-center justify-center gap-2">
        {filterButtons.map(({ mode, label, Icon }) => {
          const active = filterMode === mode;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => setFilterMode(mode)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium border transition ${
                active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-card text-foreground/80 border-border hover:bg-secondary"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {debugStages && debugStages.length > 0 && (
        <div className="mt-4 rounded-xl border border-dashed border-border bg-card/60 p-2">
          <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Pipeline-steg ({debugStages.length}) · tryck för full storlek
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {debugStages.map((s, i) => (
              <button
                key={`${s.name}-${i}`}
                type="button"
                onClick={() => setDebugZoom(s)}
                className="shrink-0 w-24 text-left"
              >
                <div
                  className="w-24 rounded-md overflow-hidden border border-border bg-white"
                  style={{ aspectRatio: `${s.width} / ${s.height}` }}
                >
                  <img
                    src={s.dataUrl}
                    alt={s.name}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className="mt-1 text-[10px] leading-tight text-foreground/80 truncate">
                  {i + 1}. {s.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {debugZoom && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 p-4"
          onClick={() => setDebugZoom(null)}
          role="dialog"
        >
          <div className="text-white text-sm mb-2 font-mono">
            {debugZoom.name} · {debugZoom.width}×{debugZoom.height}
          </div>
          <img
            src={debugZoom.dataUrl}
            alt={debugZoom.name}
            className="max-w-full max-h-[80vh] object-contain bg-white"
          />
          <div className="text-white/70 text-xs mt-2">Tryck för att stänga</div>
        </div>
      )}

      {(() => {
        const report = qualityByKey[qualityKey];
        if (!report || report.issues.length === 0) return null;
        if (dismissedQuality[qualityKey]) return null;
        return (
          <div className="mt-4 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800/60 p-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-foreground">
                  {t("qualityWarnTitle")}
                </div>
                <ul className="mt-0.5 space-y-0.5">
                  {report.issues.map((issue: QualityIssue) => (
                    <li
                      key={issue}
                      className="text-[13px] text-foreground/75 leading-snug"
                    >
                      • {t(`verdict_${issue}`)}
                    </li>
                  ))}
                </ul>
                <div className="mt-2.5 flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      deletePage(activeIndex);
                      navigate({ to: "/scan" });
                    }}
                    className="inline-flex items-center rounded-full border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground hover:bg-secondary transition"
                  >
                    {t("qualityRescan")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDismissedQuality((prev) => ({ ...prev, [qualityKey]: true }))
                    }
                    className="inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-medium text-foreground/70 hover:text-foreground transition"
                  >
                    {t("qualityUseAnyway")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      <div className="flex-1" />

      <div className="flex flex-col gap-3 pt-5">
        <PrimaryButton onClick={accept} disabled={filtering}>
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
