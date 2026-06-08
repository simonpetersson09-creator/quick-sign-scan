import type { HistoryState } from "@tanstack/history";

declare module "@tanstack/history" {
  interface HistoryState {
    scanPages?: string[];
    scanActiveIndex?: number;
  }
}
