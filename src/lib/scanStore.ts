// Scan session store, persisted to sessionStorage so an iOS background-kill
// or page reload doesn't lose a scan between capture and send.
// We only persist the *minimal* data needed to rebuild the PDF
// (source image + signature) — large derived artifacts (pdfDataUrl,
// sourceDataUrl, detection metadata) stay in memory only.
// Data is cleared on tab close or after explicit clear().

type Listener = () => void;

export interface ScanSession {
  imageDataUrl: string | null;
  sourceDataUrl: string | null;
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

const initial: ScanSession = {
  imageDataUrl: null,
  sourceDataUrl: null,
  detection: null,
  pdfDataUrl: null,
  signatureDataUrl: null,
  signaturePosition: null,
};

const STORAGE_KEY = "scanSession.v1";

// Listeners notified when sessionStorage rejects a write (quota exceeded
// is by far the most common cause on iOS Safari, ~5 MB cap).
type QuotaListener = () => void;
const quotaListeners = new Set<QuotaListener>();

function hasSessionStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.sessionStorage;
  } catch {
    return false;
  }
}

// Only persist fields cheap enough to round-trip safely.
type PersistedShape = Pick<
  ScanSession,
  "imageDataUrl" | "signatureDataUrl" | "signaturePosition"
>;

function pickPersisted(s: ScanSession): PersistedShape {
  return {
    imageDataUrl: s.imageDataUrl,
    signatureDataUrl: s.signatureDataUrl,
    signaturePosition: s.signaturePosition,
  };
}

function load(): ScanSession {
  if (!hasSessionStorage()) return { ...initial };
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...initial };
    const parsed = JSON.parse(raw) as Partial<PersistedShape>;
    return { ...initial, ...parsed };
  } catch {
    return { ...initial };
  }
}

let quotaWarned = false;

function persist(s: ScanSession) {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(pickPersisted(s)),
    );
    quotaWarned = false;
  } catch (e) {
    // sessionStorage can throw QuotaExceededError. Fall back gracefully —
    // the in-memory state still works for this session, but the user
    // will lose the scan if iOS suspends the tab.
    console.warn("[scanStore] could not persist to sessionStorage:", e);
    if (!quotaWarned) {
      quotaWarned = true;
      quotaListeners.forEach((l) => {
        try {
          l();
        } catch {
          /* listener errors must not break the store */
        }
      });
    }
  }
}

let state: ScanSession = load();
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => l());
}

export const scanStore = {
  get: () => state,
  set: (patch: Partial<ScanSession>) => {
    state = { ...state, ...patch };
    persist(state);
    notify();
  },
  clear: () => {
    state = { ...initial };
    if (hasSessionStorage()) {
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
    notify();
  },
  subscribe: (l: Listener) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  onQuotaExceeded: (l: QuotaListener) => {
    quotaListeners.add(l);
    return () => quotaListeners.delete(l);
  },
};
