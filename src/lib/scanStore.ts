// Scan session store, persisted to sessionStorage so an iOS background-kill
// or page reload doesn't lose a scan between capture and send.
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

function hasSessionStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.sessionStorage;
  } catch {
    return false;
  }
}

function load(): ScanSession {
  if (!hasSessionStorage()) return { ...initial };
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...initial };
    const parsed = JSON.parse(raw) as Partial<ScanSession>;
    return { ...initial, ...parsed };
  } catch {
    return { ...initial };
  }
}

function persist(s: ScanSession) {
  if (!hasSessionStorage()) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch (e) {
    // sessionStorage can throw QuotaExceededError for big data URLs.
    // Fall back gracefully — the in-memory state still works for this session.
    console.warn("[scanStore] could not persist to sessionStorage:", e);
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
};
