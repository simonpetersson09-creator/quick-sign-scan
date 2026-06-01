// User settings stored locally. No documents ever persisted.

export interface Recipient {
  email: string;
  label?: string;
}

export interface AppSettings {
  userEmail: string; // used as Reply-To so recipients can answer the user, not no-reply
  defaultRecipient: string;
  defaultSubject: string;
  defaultMessage: string;
  savedSignature: string | null; // dataURL or null
  recipients: Recipient[];
}

const KEY = "docscan.settings.v1";

const defaults: AppSettings = {
  userEmail: "",
  defaultRecipient: "",
  defaultSubject: "Dokument",
  defaultMessage: "Hej,\n\nBifogar dokumentet.\n\nVänliga hälsningar",
  savedSignature: null,
  recipients: [],
};

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: AppSettings) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
}
