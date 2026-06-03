// User settings stored locally.
//
// Privacy requirement: documents, images, PDFs and signatures must NEVER
// be persisted. Only non-sensitive preferences (default recipient/subject/
// message text and recent recipient email addresses) live here.

export interface Recipient {
  email: string;
  label?: string;
}

export interface AppSettings {
  defaultRecipient: string;
  defaultSubject: string;
  defaultMessage: string;
  recipients: Recipient[];
}

const KEY = "docscan.settings.v1";

const defaults: AppSettings = {
  defaultRecipient: "",
  defaultSubject: "Dokument",
  defaultMessage: "Hej,\n\nBifogar dokumentet.\n\nVänliga hälsningar",
  recipients: [],
};

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AppSettings> & {
      savedSignature?: unknown;
    };
    // Strip any legacy persisted signature from older versions.
    if (parsed && "savedSignature" in parsed) {
      delete parsed.savedSignature;
      try {
        localStorage.setItem(
          KEY,
          JSON.stringify({ ...defaults, ...parsed }),
        );
      } catch {
        /* ignore */
      }
    }
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: AppSettings) {
  if (typeof window === "undefined") return;
  // Defensive: never write a signature field even if a caller passes one.
  const { defaultRecipient, defaultSubject, defaultMessage, recipients } = s;
  localStorage.setItem(
    KEY,
    JSON.stringify({ defaultRecipient, defaultSubject, defaultMessage, recipients }),
  );
}
