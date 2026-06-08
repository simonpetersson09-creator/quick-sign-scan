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
  defaultSubject: "",
  defaultMessage: "",
  recipients: [],
};

// Legacy hard-coded Swedish defaults that previous versions persisted into
// localStorage. Treat them as "unset" so the current i18n fallback wins and
// the form shows text in the active language.
const LEGACY_SUBJECTS = new Set(["Dokument", "Document"]);
const LEGACY_MESSAGES = new Set([
  "Hej,\n\nBifogar dokumentet.\n\nVänliga hälsningar",
  "Hello,\n\nPlease find the document attached.\n\nKind regards",
]);

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
    const merged = { ...defaults, ...parsed };
    if (LEGACY_SUBJECTS.has(merged.defaultSubject)) merged.defaultSubject = "";
    if (LEGACY_MESSAGES.has(merged.defaultMessage)) merged.defaultMessage = "";
    return merged;
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
