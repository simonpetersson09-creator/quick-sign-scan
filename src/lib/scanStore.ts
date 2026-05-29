// Simple in-memory store for the current scan session.
// Documents are never persisted to disk or database.

type Listener = () => void;

export interface ScanSession {
  imageDataUrl: string | null;
  sourceDataUrl: string | null;
  detection: {
    corners: [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
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

let state: ScanSession = { ...initial };
const listeners = new Set<Listener>();

export const scanStore = {
  get: () => state,
  set: (patch: Partial<ScanSession>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  },
  clear: () => {
    state = { ...initial };
    listeners.forEach((l) => l());
  },
  subscribe: (l: Listener) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};
