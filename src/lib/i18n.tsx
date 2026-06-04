import { createContext, useContext, useEffect, useState, ReactNode } from "react";

export type Lang = "sv" | "en";

type Dict = Record<string, string>;

const sv: Dict = {
  // common
  back: "Tillbaka",
  cancel: "Avbryt",
  retry: "Försök igen",
  backHome: "Tillbaka till start",
  clear: "Rensa",

  // index
  appTagline: "Inga utskrifter. Ingen lagring. Bara signering.",
  howItWorks: "Så här fungerar det",
  step_scan: "Skanna",
  step_sign: "Signera",
  step_send: "Skicka",
  step_done: "Färdig",
  scanDocument: "Skanna dokument",
  attachFile: "Bifoga fil",
  changeLanguage: "Byt språk",

  // scan
  scanTitle: "Skanna dokument",
  statusStarting: "Startar kamera…",
  statusSearching: "Sök efter dokument",
  statusUncertain: "Kunde inte identifiera dokumentets kanter.",
  statusAlign: "Rikta in dokumentet",
  statusHold: "Håll stilla…",
  statusFocusing: "Fokuserar…",
  statusMoveBack: "Flytta telefonen något längre från dokumentet.",
  statusLowLight: "Mer ljus ger bättre detektion.",
  statusReady: "Dokument hittat",
  statusCapturing: "Skannar och rätar upp…",
  statusSaved: "Sida sparad ✓",
  savingPage: "Sparar sida…",
  statusError: "Fel",
  scanHint: "Lägg A4-dokumentet på en jämn, kontrasterande yta. Bilden tas automatiskt när hörnen är stabila.",
  scanHintMulti: "Fortsätt skanna fler sidor — tryck Klar när du är färdig.",
  doneButton: "Klar",
  pageCaptured: "Sida sparad",
  scanAnotherPage: "Skanna en sida till",
  finishScanning: "Klar — fortsätt",
  manualCapture: "Fotografera manuellt",
  errPermissionTitle: "Kamerabehörighet nekad",
  errNotFoundTitle: "Ingen kamera hittades",
  errUnknownTitle: "Kameran kunde inte startas",
  errPermissionDesc: "Appen behöver tillgång till kameran för att skanna dokument. Du kan ändra detta i enhetens inställningar.",
  errPermissionDenied: "Kamerabehörighet nekad. Appen kan inte skanna dokument utan tillgång till kameran.",
  errNotFound: "Ingen kamera hittades på den här enheten.",
  errUnknown: "Kunde inte öppna kameran. Ett oväntat fel inträffade.",
  howToEnable: "Så här aktiverar du kameran:",
  iosStep1: "Öppna {b}Inställningar{/b} på din iPhone/iPad",
  iosStep2: "Scrolla ner till {b}Safari{/b}",
  iosStep3: "Tryck på {b}Kamera{/b}",
  iosStep4: "Välj {b}Tillåt{/b}",
  iosStep5: "Gå tillbaka till appen och tryck {b}Försök igen{/b}",
  andStep1: "Tryck på {b}🔒{/b} (låsikonen) i adressfältet",
  andStep2: "Tryck på {b}Behörigheter{/b}",
  andStep3: "Välj {b}Kamera → Tillåt{/b}",
  andStep4: "Gå tillbaka till appen och tryck {b}Försök igen{/b}",
  genStep1: "Öppna webbläsarens inställningar",
  genStep2: "Hitta {b}Sekretess och säkerhet{/b}",
  genStep3: "Välj {b}Webbplatsbehörigheter{/b}",
  genStep4: "Tillåt {b}Kamera{/b} för den här webbplatsen",
  genStep5: "Gå tillbaka till appen och tryck {b}Försök igen{/b}",

  // preview
  previewTitle: "Förhandsgranska",
  previewHint: "Kontrollera att dokumentet är skarpt och komplett.",
  scannedAlt: "Skannat dokument",
  filterColor: "Färg",
  filterGray: "Grå",
  filterBw: "Svartvitt",
  cannotIdentifyEdges: "Kunde inte identifiera dokumentets kanter.",
  identifiedPolygon: "Identifierad polygon",
  hideDebug: "Dölj debug",
  showDebug: "Visa debug",
  analyzingQuality: "Analyserar kvalitet…",
  cannotAnalyze: "Kunde inte analysera",
  canContinueToSign: "Du kan gå vidare till signering.",
  useAnyway: "Du kan ändå använda bilden, eller ta om den.",
  metric_sharpness: "Skärpa",
  metric_contrast: "Kontrast",
  metric_brightness: "Ljus",
  metric_complete: "Komplett",
  useDocument: "Använd dokument",
  addPage: "Lägg till sida",
  emptyPreviewTitle: "Inget dokument ännu",
  emptyPreviewDesc: "Skanna ett dokument först, så visas det här för granskning.",
  deletePage: "Ta bort sida",
  movePageUp: "Flytta upp",
  movePageDown: "Flytta ned",
  verdict_ok: "Dokumentet ser bra ut",
  verdict_dark: "För mörkt",
  verdict_bright: "För ljust — exponeringen är överstyrd",
  verdict_low_contrast: "För lite kontrast",
  verdict_blurry: "Bilden är suddig",
  verdict_incomplete: "Dokumentet verkar inte komplett",

  // place
  placeTitle: "Placera signatur",
  placeHint: "Tryck där signaturen ska placeras. Zooma in för exakt placering.",
  signatureLabel: "Signatur",
  prevPage: "Föregående sida",
  nextPage: "Nästa sida",
  pageIndicator: "Sida {current} av {total}",
  signDocument: "Signera dokument",
  sendWithoutSignature: "Skicka utan signatur",

  // sign
  signTitle: "Signera",
  signHint: "Skriv din signatur med fingret i rutan nedan.",
  useSavedSignature: "Använd sparad signatur",
  selected: "Vald",
  tapToSelect: "Tryck för att välja",
  signHere: "Signera här",
  doneContinue: "Klar — fortsätt",
  doneAndSave: "Klar & spara signaturen",

  // review
  reviewTitle: "Granska PDF",
  documentReady: "Dokument klart",
  signed: "Signerad",
  notSigned: "Ej signerad",
  pageSingular: "sida",
  pagePlural: "sidor",
  creatingPdf: "Skapar PDF…",
  zoomIn: "Zooma in",
  zoomOut: "Zooma ut",
  approveLabel: "Jag har granskat dokumentet och godkänner att det skickas.",
  continueToEmail: "Fortsätt till e-post",
  moveSignature: "Byt signatur",
  retake: "Ta om bild",
  startOver: "Börja om",
  backToSign: "Tillbaka till signering",

  // send
  sendTitle: "Skicka via e-post",
  fieldTo: "Till",
  fieldReplyTo: "Din e-post (svar går hit)",
  fieldSubject: "Ämne",
  fieldMessage: "Meddelande",
  placeholderTo: "namn@exempel.se",
  placeholderReply: "du@exempel.se (valfritt)",
  preparing: "Förbereder…",
  processingPdf: "Bearbetar PDF… {current}/{total}",
  pdfTooManyPages: "PDF:en har för många sidor (max {max}).",
  pdfReadError: "Kunde inte läsa PDF-filen.",
  sendPdf: "Skicka PDF",
  downloadPdf: "Ladda ned PDF",
  sendFootnote: "PDF:en bifogas och skickas direkt från servern till mottagaren.",
  invalidEmail: "Ogiltig e-postadress",
  enterEmail: "Ange en e-postadress",
  emailTooLong: "E-postadressen är för lång",
  done: "Klart",
  doneCleared: "Dokumentet har raderats från appen.",
  err_attachment_too_large: 'PDF:en är för stor för att skickas. Tryck "Ladda ned PDF" och skicka manuellt.',
  err_invalid_recipient: "Mottagaradressen avvisades. Kontrollera stavningen och försök igen.",
  err_rate_limited: "För många utskick på kort tid. Vänta en stund och försök igen.",
  err_network_error: "Nätverksfel – kontrollera anslutningen och försök igen.",
  err_unauthorized: "E-posttjänsten är inte korrekt konfigurerad. Kontakta administratör.",
  err_unknown: 'Kunde inte skicka mailet. Försök igen, eller tryck "Ladda ned PDF" och skicka manuellt.',
  defaultSubjectFallback: "Skannat dokument",
  defaultSubjectInitial: "Dokument",
  defaultMessageInitial: "Hej,\n\nBifogar dokumentet.\n\nVänliga hälsningar",
  largePdfWarning: "Varning: PDF:en är {mb} MB. Stora bilagor kan blockeras av mottagarens server – om utskicket misslyckas, använd \"Ladda ned PDF\" och skicka manuellt.",

  // settings
  settingsTitle: "Inställningar",
  defaultRecipientLabel: "Standardmottagare",
  defaultSubjectLabel: "Standardämne",
  defaultMessageLabel: "Standardmeddelande",
  savedSignatureLabel: "Sparad signatur",
  removeSignature: "Ta bort signatur",
  noSignatureYet: "Ingen signatur sparad ännu. Du kan spara en signatur när du signerar ett dokument.",
  recentRecipients: "Senaste mottagare",
  removeRecipient: "Ta bort",
  clearRecipients: "Rensa alla sparade adresser",
  recipientsFootnote: "E-postadresser sparas endast lokalt på den här enheten.",
  saveSettings: "Spara inställningar",
  savedCheck: "Sparat ✓",
  settingsFootnote: "Inga dokument sparas — endast dina inställningar.",

  // app shell
  pdfPreview: "PDF-förhandsvisning",

  // quota
  scanTooLargeTitle: "Skanningen är för stor för att sparas på enheten",
  scanTooLargeDesc: "Den ligger kvar i minnet, men ladda inte om sidan innan du skickat – då försvinner dokumentet.",
};

const en: Dict = {
  // common
  back: "Back",
  cancel: "Cancel",
  retry: "Try again",
  backHome: "Back to home",
  clear: "Clear",

  // index
  appTagline: "No printing. No storage. Just signing.",
  howItWorks: "How it works",
  step_scan: "Scan",
  step_sign: "Sign",
  step_send: "Send",
  step_done: "Done",
  scanDocument: "Scan document",
  attachFile: "Attach file",
  changeLanguage: "Change language",

  // scan
  scanTitle: "Scan document",
  statusStarting: "Starting camera…",
  statusSearching: "Searching for document",
  statusUncertain: "Couldn't detect the document's edges.",
  statusAlign: "Align the document",
  statusHold: "Hold still…",
  statusFocusing: "Focusing…",
  statusMoveBack: "Move the phone slightly further from the document.",
  statusLowLight: "Too little light — move to a brighter spot.",
  statusReady: "Document found",
  statusCapturing: "Scanning and straightening…",
  statusSaved: "Page saved ✓",
  savingPage: "Saving page…",
  statusError: "Error",
  scanHint: "Place the A4 document on a flat, contrasting surface. The photo is taken automatically when the corners are stable.",
  scanHintMulti: "Keep scanning more pages — tap Done when finished.",
  doneButton: "Done",
  pageCaptured: "Page saved",
  scanAnotherPage: "Scan another page",
  finishScanning: "Done — continue",
  manualCapture: "Take photo manually",
  errPermissionTitle: "Camera permission denied",
  errNotFoundTitle: "No camera found",
  errUnknownTitle: "Couldn't start camera",
  errPermissionDesc: "The app needs camera access to scan documents. You can change this in your device settings.",
  errPermissionDenied: "Camera permission denied. The app cannot scan documents without camera access.",
  errNotFound: "No camera was found on this device.",
  errUnknown: "Couldn't open the camera. An unexpected error occurred.",
  howToEnable: "How to enable the camera:",
  iosStep1: "Open {b}Settings{/b} on your iPhone/iPad",
  iosStep2: "Scroll down to {b}Safari{/b}",
  iosStep3: "Tap {b}Camera{/b}",
  iosStep4: "Choose {b}Allow{/b}",
  iosStep5: "Return to the app and tap {b}Try again{/b}",
  andStep1: "Tap the {b}🔒{/b} (lock icon) in the address bar",
  andStep2: "Tap {b}Permissions{/b}",
  andStep3: "Choose {b}Camera → Allow{/b}",
  andStep4: "Return to the app and tap {b}Try again{/b}",
  genStep1: "Open your browser settings",
  genStep2: "Find {b}Privacy and security{/b}",
  genStep3: "Choose {b}Site permissions{/b}",
  genStep4: "Allow {b}Camera{/b} for this site",
  genStep5: "Return to the app and tap {b}Try again{/b}",

  // preview
  previewTitle: "Preview",
  previewHint: "Make sure the document is sharp and complete.",
  scannedAlt: "Scanned document",
  filterColor: "Color",
  filterGray: "Gray",
  filterBw: "B&W",
  cannotIdentifyEdges: "Couldn't detect the document's edges.",
  identifiedPolygon: "Detected polygon",
  hideDebug: "Hide debug",
  showDebug: "Show debug",
  analyzingQuality: "Analyzing quality…",
  cannotAnalyze: "Couldn't analyze",
  canContinueToSign: "You can continue to signing.",
  useAnyway: "You can use the image anyway, or retake it.",
  metric_sharpness: "Sharpness",
  metric_contrast: "Contrast",
  metric_brightness: "Brightness",
  metric_complete: "Complete",
  useDocument: "Use document",
  addPage: "Add page",
  emptyPreviewTitle: "No document yet",
  emptyPreviewDesc: "Scan a document first, then it will appear here for review.",
  deletePage: "Delete page",
  movePageUp: "Move up",
  movePageDown: "Move down",
  verdict_ok: "The document looks good",
  verdict_dark: "Too dark",
  verdict_bright: "Too bright — exposure is blown out",
  verdict_low_contrast: "Not enough contrast",
  verdict_blurry: "The image is blurry",
  verdict_incomplete: "The document seems incomplete",

  // place
  placeTitle: "Place signature",
  placeHint: "Tap where the signature should be placed. Zoom in for precise placement.",
  signatureLabel: "Signature",
  prevPage: "Previous page",
  nextPage: "Next page",
  pageIndicator: "Page {current} of {total}",
  signDocument: "Sign document",
  sendWithoutSignature: "Send without signature",

  // sign
  signTitle: "Sign",
  signHint: "Draw your signature with your finger in the box below.",
  useSavedSignature: "Use saved signature",
  selected: "Selected",
  tapToSelect: "Tap to select",
  signHere: "Sign here",
  doneContinue: "Done — continue",
  doneAndSave: "Done & save signature",

  // review
  reviewTitle: "Review PDF",
  documentReady: "Document ready",
  signed: "Signed",
  notSigned: "Not signed",
  pageSingular: "page",
  pagePlural: "pages",
  creatingPdf: "Creating PDF…",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  approveLabel: "I have reviewed the document and approve it to be sent.",
  continueToEmail: "Continue to email",
  moveSignature: "Change signature",
  retake: "Retake photo",
  startOver: "Start over",
  backToSign: "Back to signing",

  // send
  sendTitle: "Send via email",
  fieldTo: "To",
  fieldReplyTo: "Your email (replies go here)",
  fieldSubject: "Subject",
  fieldMessage: "Message",
  placeholderTo: "name@example.com",
  placeholderReply: "you@example.com (optional)",
  preparing: "Preparing…",
  processingPdf: "Processing PDF… {current}/{total}",
  pdfTooManyPages: "PDF has too many pages (max {max}).",
  pdfReadError: "Could not read the PDF file.",
  sendPdf: "Send PDF",
  downloadPdf: "Download PDF",
  sendFootnote: "The PDF is attached and sent directly from the server to the recipient.",
  invalidEmail: "Invalid email address",
  enterEmail: "Enter an email address",
  emailTooLong: "The email address is too long",
  done: "Done",
  doneCleared: "The document has been deleted from the app.",
  err_attachment_too_large: 'The PDF is too large to send. Tap "Download PDF" and send it manually.',
  err_invalid_recipient: "The recipient address was rejected. Check the spelling and try again.",
  err_rate_limited: "Too many sends in a short time. Wait a moment and try again.",
  err_network_error: "Network error – check your connection and try again.",
  err_unauthorized: "The email service is not configured correctly. Contact the administrator.",
  err_unknown: 'Could not send the email. Try again, or tap "Download PDF" and send it manually.',
  defaultSubjectFallback: "Scanned document",
  defaultSubjectInitial: "Document",
  defaultMessageInitial: "Hello,\n\nPlease find the document attached.\n\nKind regards",
  largePdfWarning: "Warning: the PDF is {mb} MB. Large attachments may be blocked by the recipient's server – if sending fails, use \"Download PDF\" and send manually.",

  // settings
  settingsTitle: "Settings",
  defaultRecipientLabel: "Default recipient",
  defaultSubjectLabel: "Default subject",
  defaultMessageLabel: "Default message",
  savedSignatureLabel: "Saved signature",
  removeSignature: "Remove signature",
  noSignatureYet: "No signature saved yet. You can save one when signing a document.",
  recentRecipients: "Recent recipients",
  removeRecipient: "Remove",
  clearRecipients: "Clear all saved addresses",
  recipientsFootnote: "Email addresses are stored only locally on this device.",
  saveSettings: "Save settings",
  savedCheck: "Saved ✓",
  settingsFootnote: "No documents are saved — only your settings.",

  // app shell
  pdfPreview: "PDF preview",

  // quota
  scanTooLargeTitle: "The scan is too large to be stored on the device",
  scanTooLargeDesc: "It remains in memory, but don't reload the page before sending – the document will be lost.",
};

const dicts: Record<Lang, Dict> = { sv, en };

interface Ctx {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LangContext = createContext<Ctx | null>(null);

const STORAGE_KEY = "signgo.lang";

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("sv");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "sv" || stored === "en") setLangState(stored);
    } catch {}
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = lang;
    }
  }, [lang]);

  function setLang(l: Lang) {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
    if (typeof document !== "undefined") {
      document.documentElement.lang = l;
    }
  }

  function toggle() {
    setLang(lang === "sv" ? "en" : "sv");
  }

  function t(key: string, vars?: Record<string, string | number>) {
    let s = dicts[lang][key] ?? dicts.sv[key] ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        s = s.replaceAll(`{${k}}`, String(v));
      }
    }
    return s;
  }

  return <LangContext.Provider value={{ lang, setLang, toggle, t }}>{children}</LangContext.Provider>;
}

export function useLang() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error("useLang must be used within LanguageProvider");
  return ctx;
}

export function useT() {
  return useLang().t;
}
