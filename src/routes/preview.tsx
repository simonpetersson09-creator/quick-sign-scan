import { createFileRoute, useLocation, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PrimaryButton } from "@/components/PrimaryButton";
import { scanStore } from "@/lib/scanStore";
import { useT } from "@/lib/i18n";
import { applyFilter, type FilterMode } from "@/lib/imageFilters";
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
  // Default to grayscale — safest for documents with faint/light text.
  // BW (Sauvola) is still available but can erase very pale ink.
  const [filterMode, setFilterMode] = useState<FilterMode>("gray");
  // Cache filtered results so flipping pages stays instant: key = `${index}|${mode}`
  const filterCache = useRef<Map<string, string>>(new Map());
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [filtering, setFiltering] = useState(false);

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
      scanStore.clearPreviewHandoff();
      window.history.replaceState(
        { ...window.history.state, scanPages: undefined, scanActiveIndex: undefined },
        "",
      );
    } else if (scanStore.getPages().length) {
      scanStore.clearPreviewHandoff();
    }
    const first = list[0];
    console.info("[preview] mounted with pages count", {
      pages: list.length,
      firstPageExists: Boolean(first),
      firstImageSrcValid: Boolean(first?.startsWith("data:image/") || first?.startsWith("blob:")),
      imageDataUrlExists: Boolean(scanStore.get().imageDataUrl),
    });
  }, [handedOffPages, navState.scanActiveIndex, recoveredActiveIndex, recoveredPages]);

  // Subscribe to store updates so any late mutation (race with navigation,
  // or external change) reflects here.
  useEffect(() => {
    const sync = () => {
      const session = scanStore.get();
      const list = scanStore.getPages();
      setPages(list);
      if (!list.length) {
        setActiveIndex(0);
        return;
      }
      const idx = session.imageDataUrl
        ? Math.max(0, list.indexOf(session.imageDataUrl))
        : list.length - 1;
      setActiveIndex((prev) => (prev >= 0 && prev < list.length ? prev : idx));
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

  // Invalidate cache when the underlying pages change (delete, reorder).
  useEffect(() => {
    filterCache.current.clear();
  }, [pages]);

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
              Ingen skanning att visa
            </h2>
            <p className="max-w-[260px] text-sm text-muted-foreground">
              Bilden kunde inte hämtas. Skanna sidan igen utan att lämna appen under tiden.
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

      <div className="flex items-center justify-center">
        <div
          className="relative flex items-center justify-center"
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
            className="relative rounded-2xl overflow-hidden border border-border bg-muted/30 p-3"
            style={{ width: "min(78vw, 340px)", aspectRatio: "1 / 1.414" }}
          >
            <img
              src={displayUrl ?? originalImage}
              alt={t("scannedAlt")}
              className="w-full h-full object-contain bg-white"
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
