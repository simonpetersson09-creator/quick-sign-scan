// In-memory only scan session store.
//
// Privacy requirement: documents, images, PDFs, signatures and related
// metadata MUST NEVER be persisted. Nothing here touches localStorage,
// sessionStorage, IndexedDB, cookies, or any other durable storage.
// All data lives only in this module's memory for the lifetime of the tab,
// and is wiped on reload / navigation away / tab close.

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

function wipe() {
  // Overwrite references so large strings can be GC'd immediately and
  // never linger as stale closures.
  bag.state = createInitial();
}

function sessionPages(session: ScanSession) {
  return session.pages.length > 0
    ? session.pages.filter(Boolean)
    : session.imageDataUrl
      ? [session.imageDataUrl]
      : [];
}

export const scanStore = {
  get: () => bag.state,
  getPages: () => sessionPages(bag.state),
  addPage: (dataUrl: string, patch: Partial<ScanSession> = {}) => {
    if (!dataUrl) return bag.state;
    const { pages: _pages, imageDataUrl: _imageDataUrl, ...rest } = patch;
    const nextPages = [...sessionPages(bag.state), dataUrl];
    bag.state = {
      ...bag.state,
      ...rest,
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
  clear: () => {
    wipe();
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

// Auto-cleanup: if the user closes the tab, navigates away, refreshes,
// or the page is hidden/backgrounded, drop all scan data immediately.
if (typeof window !== "undefined" && !bag.cleanupBound) {
  bag.cleanupBound = true;
  const cleanup = () => wipe();
  window.addEventListener("pagehide", cleanup);
  window.addEventListener("beforeunload", cleanup);
  // Some mobile browsers only fire visibilitychange when backgrounded.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      // Intentionally NOT wiping on hidden — user may switch apps briefly
      // mid-flow. We only wipe on real unload/pagehide.
    }
  });
}
