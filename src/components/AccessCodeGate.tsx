import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Lock, Loader2 } from "lucide-react";

import { useLang } from "@/lib/i18n";
import {
  hasUsableAccessCode,
  isCapacitor,
  setAccessCode,
} from "@/lib/access-code";
import { verifyAccessCode } from "@/lib/access.functions";

type Strings = {
  title: string;
  description: string;
  placeholder: string;
  submit: string;
  checking: string;
  invalid: string;
  network: string;
  footnote: string;
};

const STRINGS: Record<"sv" | "en", Strings> = {
  sv: {
    title: "Åtkomstkod krävs",
    description:
      "Den här appen är skyddad. Ange din åtkomstkod för att fortsätta.",
    placeholder: "Åtkomstkod",
    submit: "Lås upp",
    checking: "Kontrollerar…",
    invalid: "Felaktig åtkomstkod.",
    network: "Kunde inte kontrollera koden. Försök igen.",
    footnote: "Koden sparas lokalt på den här enheten.",
  },
  en: {
    title: "Access code required",
    description:
      "This app is protected. Enter your access code to continue.",
    placeholder: "Access code",
    submit: "Unlock",
    checking: "Checking…",
    invalid: "Incorrect access code.",
    network: "Couldn't verify the code. Try again.",
    footnote: "The code is stored locally on this device.",
  },
};

export function AccessCodeGate({ children }: { children: React.ReactNode }) {
  // Capacitor build always has the baked-in code; render children immediately.
  // On web, render the gate when no code is stored yet.
  const [unlocked, setUnlocked] = useState(() => hasUsableAccessCode());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { lang } = useLang();
  const t = STRINGS[lang];

  const verifyFn = useServerFn(verifyAccessCode);

  if (unlocked) return <>{children}</>;
  // Belt-and-braces: never show the gate inside the native shell.
  if (isCapacitor()) return <>{children}</>;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) return;
    setError(null);
    setBusy(true);
    try {
      const res = await verifyFn({ data: { code: trimmed } });
      if (res.ok) {
        setAccessCode(trimmed);
        setUnlocked(true);
      } else {
        setError(t.invalid);
      }
    } catch {
      setError(t.network);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center bg-background px-6 pt-safe pb-safe">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center">
          <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <Lock className="h-5 w-5 text-primary" strokeWidth={1.75} />
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">
            {t.title}
          </h1>
          <p className="text-sm text-muted-foreground mt-2">{t.description}</p>
        </div>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-3">
          <input
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="text"
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError(null);
            }}
            placeholder={t.placeholder}
            aria-invalid={!!error}
            disabled={busy}
            className="w-full rounded-xl border border-border bg-card px-4 py-3 text-[16px] text-foreground outline-none transition focus:border-primary disabled:opacity-60"
          />
          {error && (
            <p className="text-xs text-destructive ml-1">{error}</p>
          )}
          <button
            type="submit"
            disabled={busy || code.trim().length === 0}
            className="rounded-xl bg-primary text-primary-foreground h-11 px-6 shadow-[var(--shadow-card)] transition active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-[15px] font-semibold">{t.checking}</span>
              </>
            ) : (
              <span className="text-[15px] font-semibold">{t.submit}</span>
            )}
          </button>
          <p className="text-[11px] text-muted-foreground/70 text-center mt-1">
            {t.footnote}
          </p>
        </form>
      </div>
    </div>
  );
}
