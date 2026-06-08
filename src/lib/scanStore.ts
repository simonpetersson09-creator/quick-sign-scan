// Scan session store.
//
// Privacy requirement: documents, images, PDFs, signatures and related
// metadata normally lives only in memory and is wiped on reload / tab close.
// The one exception is a short-lived same-tab handoff used only while moving
// from /scan to /preview; preview consumes and removes it immediately. This
// prevents mobile browsers or stale route chunks from dropping the captured
// image during navigation.

type Listener = () => void;

export interface ScanSession {
  imageDataUrl: string | null;
  sourceDataUrl: string | null;
  // All scanned pages in order. The last entry mirrors imageDataUrl and
  // is the page used for signature placement.
  pages: string[];
  detection: {
    corners: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    a4Ratio: number;
    confidence: number;
    debug: {
      edgeThreshold: number;
      threshold: number;
      candidateCount: number;
      a4Score: number;
      edgeScore: number;
      brightnessScore: number;
      textScore: number;
      areaRatio: number;
      sideDeviation: number;
      perspectiveError: number;
      polygonFill: number;
    };
  } | null;
  pdfDataUrl: string | null;
  signatureDataUrl: string | null;
  signaturePosition: { x: number; y: number } | null; // normalized 0..1
}

function createInitial(): ScanSession {
  return {
    imageDataUrl: null,
    sourceDataUrl: null,
    pages: [],
    detection: null,
    pdfDataUrl: null,
    signatureDataUrl: null,
    signaturePosition: null,
  };
}

type StoreBag = {
  state: ScanSession;
  listeners: Set<Listener>;
  cleanupBound: boolean;
};

type PreviewHandoff = {
  pages: string[];
  activeIndex: number;
  createdAt: number;
};

const PREVIEW_HANDOFF_KEY = "docscan.preview-handoff.v1";
const PREVIEW_HANDOFF_WINDOW_NAME_PREFIX = `${PREVIEW_HANDOFF_KEY}:`;
const PREVIEW_HANDOFF_MAX_AGE_MS = 2 * 60 * 1000;

const storeGlobal = globalThis as typeof globalThis & {
  __SIGN_GO_SCAN_STORE__?: StoreBag;
};

const bag =
  storeGlobal.__SIGN_GO_SCAN_STORE__ ??
  (storeGlobal.__SIGN_GO_SCAN_STORE__ = {
    state: createInitial(),
    listeners: new Set<Listener>(),
    cleanupBound: false,
  });

function notify() {
  bag.listeners.forEach((l) => l());
}

function debugScanStore(message: string, details: Record<string, unknown> = {}) {
  if (typeof console !== "undefined") {
    console.info(`[scanStore] ${message}`, details);
  }
}

function wipe(reason: string) {
  // Overwrite references so large strings can be GC'd immediately and
  // never linger as stale closures.
  debugScanStore("wipe state", {
    reason,
    pagesBefore: sessionPages(bag.state).length,
    imageDataUrlExists: Boolean(bag.state.imageDataUrl),
  });
  bag.state = createInitial();
}

function sessionPages(session: ScanSession) {
  return session.pages.length > 0
    ? session.pages.filter(Boolean)
    : session.imageDataUrl
      ? [session.imageDataUrl]
      : [];
}

function isUsablePreviewPage(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:image/") && value.length > 1024;
}

function safeSessionStorage() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export const scanStore = {
  get: () => bag.state,
  getPages: () => sessionPages(bag.state),
  addPage: (dataUrl: string, patch: Partial<ScanSession> = {}) => {
    if (!dataUrl) return bag.state;
    const nextPages = [...sessionPages(bag.state), dataUrl];
    debugScanStore("addPage", {
      pagesBefore: nextPages.length - 1,
      pagesAfter: nextPages.length,
      dataUrlValid: dataUrl.startsWith("data:image/"),
      dataUrlBytes: dataUrl.length,
    });
    bag.state = {
      ...bag.state,
      ...patch,
      pages: nextPages,
      imageDataUrl: dataUrl,
    };
    notify();
    return bag.state;
  },
  set: (patch: Partial<ScanSession>) => {
    bag.state = { ...bag.state, ...patch };
    notify();
  },
  savePreviewHandoff: (pages: string[], activeIndex: number) => {
    const safePages = pages.filter(isUsablePreviewPage);
    if (!safePages.length) return false;
    const storage = safeSessionStorage();
    let saved = false;
    if (!storage) return false;
    try {
      const safeActiveIndex = Math.max(0, Math.min(safePages.length - 1, activeIndex));
      const payload = JSON.stringify({ pages: safePages, activeIndex: safeActiveIndex, createdAt: Date.now() });
      storage.setItem(PREVIEW_HANDOFF_KEY, payload);
      // Secondary same-tab handoff. This survives a dev-server/HMR reload or
      // route-chunk reload even when sessionStorage write/read is unavailable.
      window.name = `${PREVIEW_HANDOFF_WINDOW_NAME_PREFIX}${payload}`;
      debugScanStore("saved preview handoff", {
        pages: safePages.length,
        activeIndex: safeActiveIndex,
      });
      saved = true;
    } catch (error) {
      debugScanStore("preview handoff save failed", {
        pages: safePages.length,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
    return saved;
  },
  readPreviewHandoff: (): PreviewHandoff | null => {
    const storage = safeSessionStorage();
    const candidates: string[] = [];
    try {
      const raw = storage.getItem(PREVIEW_HANDOFF_KEY);
      if (raw) candidates.push(raw);
    } catch {}
    try {
      if (window.name.startsWith(PREVIEW_HANDOFF_WINDOW_NAME_PREFIX)) {
        candidates.push(window.name.slice(PREVIEW_HANDOFF_WINDOW_NAME_PREFIX.length));
      }
    } catch {}
    for (const raw of candidates) {
      try {
      const parsed = JSON.parse(raw) as Partial<PreviewHandoff>;
      const pages = Array.isArray(parsed.pages) ? parsed.pages.filter(isUsablePreviewPage) : [];
      const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;
        if (!pages.length || Date.now() - createdAt > PREVIEW_HANDOFF_MAX_AGE_MS) continue;
      const activeIndex =
        typeof parsed.activeIndex === "number"
          ? Math.max(0, Math.min(pages.length - 1, parsed.activeIndex))
          : pages.length - 1;
      debugScanStore("read preview handoff", { pages: pages.length, activeIndex });
      return { pages, activeIndex, createdAt };
    } catch {
        // Try the next handoff source.
      }
    }
    try {
      storage?.removeItem(PREVIEW_HANDOFF_KEY);
      if (window.name.startsWith(PREVIEW_HANDOFF_WINDOW_NAME_PREFIX)) window.name = "";
    } catch {}
    return null;
    }
  clearPreviewHandoff: () => {
    try {
      safeSessionStorage()?.removeItem(PREVIEW_HANDOFF_KEY);
      if (window.name.startsWith(PREVIEW_HANDOFF_WINDOW_NAME_PREFIX)) window.name = "";
    } catch {}
  },
  clear: (reason = "explicit") => {
    debugScanStore("clear called", {
      reason,
      pagesBefore: sessionPages(bag.state).length,
      imageDataUrlExists: Boolean(bag.state.imageDataUrl),
    });
    try {
      safeSessionStorage()?.removeItem(PREVIEW_HANDOFF_KEY);
    } catch {}
    wipe(reason);
    notify();
  },
  subscribe: (l: Listener) => {
    bag.listeners.add(l);
    return () => bag.listeners.delete(l);
  },
  // Kept for API compatibility with previous version. Always a no-op now
  // since nothing is ever persisted.
  onQuotaExceeded: (_l: () => void) => () => {},
};

// Auto-cleanup only on real unload/refresh. Do not wipe on SPA route changes,
// camera unmount, pagehide/BFCache, or temporary mobile backgrounding — preview
// must be able to read the just-scanned pages from the same in-memory session.
if (typeof window !== "undefined" && !bag.cleanupBound) {
  bag.cleanupBound = true;
  const cleanup = () => wipe("beforeunload");
  window.addEventListener("beforeunload", cleanup);
  // Some mobile browsers only fire visibilitychange when backgrounded.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // Intentionally NOT wiping on hidden — user may switch apps briefly
      // mid-flow. We only wipe on real unload/refresh.
    }
  });
}
