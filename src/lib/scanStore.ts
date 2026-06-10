// Scan session store.
//
// Privacy requirement: documents, images, PDFs, signatures and related
// metadata normally lives only in memory and is wiped on reload / tab close.
// The one exception is a short-lived same-tab active-document handoff used
// while moving through scan/preview. It is cleared only by explicit document
// cleanup, not by camera cleanup or a preview image load, so route/HMR reloads
// cannot drop the captured page mid-flow.

type Listener = () => void;

export interface ScanDebugStage {
  name: string;
  width: number;
  height: number;
  dataUrl: string;
}

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
  /** Per-stage thumbnails from the last capture, when ?stagedump=1 is on. */
  debugStages: ScanDebugStage[] | null;
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
    debugStages: null,
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
  signatureDataUrl: string | null;
  signaturePosition: { x: number; y: number } | null;
};

const PREVIEW_HANDOFF_KEY = "docscan.preview-handoff.v1";
const PREVIEW_HANDOFF_WINDOW_NAME_PREFIX = `${PREVIEW_HANDOFF_KEY}:`;
const PREVIEW_HANDOFF_MAX_AGE_MS = 30 * 60 * 1000;
const PREVIEW_HANDOFF_DB = "docscan-preview-handoff";
const PREVIEW_HANDOFF_STORE = "handoff";

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

function parsePreviewHandoff(raw: string | null | undefined): PreviewHandoff | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PreviewHandoff>;
    const pages = Array.isArray(parsed.pages) ? parsed.pages.filter(isUsablePreviewPage) : [];
    const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : 0;
    if (!pages.length || Date.now() - createdAt > PREVIEW_HANDOFF_MAX_AGE_MS) return null;
    const activeIndex =
      typeof parsed.activeIndex === "number"
        ? Math.max(0, Math.min(pages.length - 1, parsed.activeIndex))
        : pages.length - 1;
    const signatureDataUrl =
      typeof parsed.signatureDataUrl === "string" && parsed.signatureDataUrl.startsWith("data:image/")
        ? parsed.signatureDataUrl
        : null;
    const sp = parsed.signaturePosition;
    const signaturePosition =
      sp && typeof sp.x === "number" && typeof sp.y === "number" ? { x: sp.x, y: sp.y } : null;
    return { pages, activeIndex, createdAt, signatureDataUrl, signaturePosition };
  } catch {
    return null;
  }
}

function openPreviewHandoffDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(PREVIEW_HANDOFF_DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PREVIEW_HANDOFF_STORE)) {
        db.createObjectStore(PREVIEW_HANDOFF_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function savePreviewHandoffToIndexedDb(payload: string) {
  const db = await openPreviewHandoffDb();
  if (!db) return false;
  return new Promise<boolean>((resolve) => {
    const tx = db.transaction(PREVIEW_HANDOFF_STORE, "readwrite");
    tx.objectStore(PREVIEW_HANDOFF_STORE).put(payload, PREVIEW_HANDOFF_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve(true);
    };
    tx.onerror = () => {
      db.close();
      resolve(false);
    };
  });
}

async function readPreviewHandoffFromIndexedDb() {
  const db = await openPreviewHandoffDb();
  if (!db) return null;
  return new Promise<string | null>((resolve) => {
    const tx = db.transaction(PREVIEW_HANDOFF_STORE, "readonly");
    const req = tx.objectStore(PREVIEW_HANDOFF_STORE).get(PREVIEW_HANDOFF_KEY);
    req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
    req.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function deletePreviewHandoffFromIndexedDb() {
  const db = await openPreviewHandoffDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(PREVIEW_HANDOFF_STORE, "readwrite");
    tx.objectStore(PREVIEW_HANDOFF_STORE).delete(PREVIEW_HANDOFF_KEY);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}

function createPreviewHandoffPayload(pages: string[], activeIndex: number) {
  const safePages = pages.filter(isUsablePreviewPage);
  if (!safePages.length) return null;
  const safeActiveIndex = Math.max(0, Math.min(safePages.length - 1, activeIndex));
  // Include the signature so a reload between /sign and /review or /send
  // doesn't silently drop it (pages used to be the only thing recovered).
  const payload = JSON.stringify({
    pages: safePages,
    activeIndex: safeActiveIndex,
    createdAt: Date.now(),
    signatureDataUrl: bag.state.signatureDataUrl ?? null,
    signaturePosition: bag.state.signaturePosition ?? null,
  });
  return { safePages, safeActiveIndex, payload };
}

function savePreviewHandoffSync(pages: string[], activeIndex: number, reason: string) {
  const handoff = createPreviewHandoffPayload(pages, activeIndex);
  if (!handoff) return false;
  const { safePages, safeActiveIndex, payload } = handoff;
  const storage = safeSessionStorage();
  let saved = false;
  try {
    storage?.setItem(PREVIEW_HANDOFF_KEY, payload);
    saved = true;
  } catch (error) {
    debugScanStore("preview session handoff save failed", {
      reason,
      pages: safePages.length,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  try {
    if (typeof window !== "undefined") {
      // Secondary same-tab handoff. This survives a dev-server/HMR reload or
      // route-chunk reload even when sessionStorage write/read is unavailable.
      window.name = `${PREVIEW_HANDOFF_WINDOW_NAME_PREFIX}${payload}`;
      saved = true;
    }
  } catch (error) {
    debugScanStore("preview handoff save failed", {
      reason,
      pages: safePages.length,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  savePreviewHandoffToIndexedDb(payload).catch(() => {});
  debugScanStore("saved preview handoff", {
    reason,
    pages: safePages.length,
    activeIndex: safeActiveIndex,
    saved,
  });
  return saved;
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
    // Persist the handoff immediately at capture time, not only when Done is
    // pressed. Yesterday's recurring blank-preview failure happened when a
    // dev/HMR reload or route error landed between addPage() and /preview.
    savePreviewHandoffSync(nextPages, nextPages.length - 1, "addPage");
    notify();
    return bag.state;
  },
  set: (patch: Partial<ScanSession>) => {
    bag.state = { ...bag.state, ...patch };
    const pages = sessionPages(bag.state);
    const touchesHandoff =
      "pages" in patch ||
      "imageDataUrl" in patch ||
      "signatureDataUrl" in patch ||
      "signaturePosition" in patch;
    if (pages.length && touchesHandoff) {
      const activeIndex = bag.state.imageDataUrl
        ? Math.max(0, pages.indexOf(bag.state.imageDataUrl))
        : pages.length - 1;
      savePreviewHandoffSync(pages, activeIndex >= 0 ? activeIndex : pages.length - 1, "set");
    }
    notify();
  },
  savePreviewHandoff: (pages: string[], activeIndex: number) => {
    return savePreviewHandoffSync(pages, activeIndex, "explicit");
  },
  savePreviewHandoffAsync: async (pages: string[], activeIndex: number) => {
    const handoff = createPreviewHandoffPayload(pages, activeIndex);
    if (!handoff) return false;
    const savedSync = savePreviewHandoffSync(handoff.safePages, handoff.safeActiveIndex, "done-to-preview");
    const savedDb = await savePreviewHandoffToIndexedDb(handoff.payload);
    debugScanStore("preview handoff async save complete", {
      pages: handoff.safePages.length,
      activeIndex: handoff.safeActiveIndex,
      savedSync,
      savedDb,
    });
    return savedSync || savedDb;
  },
  readPreviewHandoff: (): PreviewHandoff | null => {
    const storage = safeSessionStorage();
    const candidates: string[] = [];
    try {
      const raw = storage?.getItem(PREVIEW_HANDOFF_KEY);
      if (raw) candidates.push(raw);
    } catch {}
    try {
      if (window.name.startsWith(PREVIEW_HANDOFF_WINDOW_NAME_PREFIX)) {
        candidates.push(window.name.slice(PREVIEW_HANDOFF_WINDOW_NAME_PREFIX.length));
      }
    } catch {}
    for (const raw of candidates) {
      const parsed = parsePreviewHandoff(raw);
      if (parsed) {
        debugScanStore("read preview handoff", { pages: parsed.pages.length, activeIndex: parsed.activeIndex });
        return parsed;
      }
    }
    try {
      storage?.removeItem(PREVIEW_HANDOFF_KEY);
      if (window.name.startsWith(PREVIEW_HANDOFF_WINDOW_NAME_PREFIX)) window.name = "";
    } catch {}
    return null;
  },
  readPreviewHandoffAsync: async (): Promise<PreviewHandoff | null> => {
    const sync = scanStore.readPreviewHandoff();
    if (sync) return sync;
    const parsed = parsePreviewHandoff(await readPreviewHandoffFromIndexedDb());
    if (parsed) {
      debugScanStore("read preview handoff from indexeddb", {
        pages: parsed.pages.length,
        activeIndex: parsed.activeIndex,
      });
      return parsed;
    }
    await deletePreviewHandoffFromIndexedDb();
    return null;
  },
  clearPreviewHandoff: () => {
    try {
      safeSessionStorage()?.removeItem(PREVIEW_HANDOFF_KEY);
      if (window.name.startsWith(PREVIEW_HANDOFF_WINDOW_NAME_PREFIX)) window.name = "";
    } catch {}
    deletePreviewHandoffFromIndexedDb().catch(() => {});
  },
  clear: (reason = "explicit") => {
    debugScanStore("clear called", {
      reason,
      pagesBefore: sessionPages(bag.state).length,
      imageDataUrlExists: Boolean(bag.state.imageDataUrl),
    });
    try {
      safeSessionStorage()?.removeItem(PREVIEW_HANDOFF_KEY);
      if (window.name.startsWith(PREVIEW_HANDOFF_WINDOW_NAME_PREFIX)) window.name = "";
    } catch {}
    deletePreviewHandoffFromIndexedDb().catch(() => {});
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
