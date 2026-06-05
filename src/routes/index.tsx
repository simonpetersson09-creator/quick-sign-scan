import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ScanLine, PenLine, Mail, CheckCircle2, Settings as SettingsIcon, ArrowDown, Globe, FileUp, Loader2, Crown } from "lucide-react";
import { useLang } from "@/lib/i18n";
import { scanStore } from "@/lib/scanStore";
import { pdfFileToImages } from "@/lib/pdfToImages";
import { usePremium, useUsage } from "@/hooks/usePremium";
import { WelcomeCard } from "@/components/WelcomeCard";

const MAX_PDF_PAGES = 20;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SSPP Sign & Go" },
      { name: "description", content: "SSPP Sign & Go: skanna, signera, skicka." },
    ],
  }),
  component: Home,
});

function Home() {
  const { lang, toggle, t } = useLang();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const premium = usePremium();
  const { remaining } = useUsage();
  const isPremium = premium.state === "active";

  const steps = [
    { icon: ScanLine, label: t("step_scan") },
    { icon: PenLine, label: t("step_sign") },
    { icon: Mail, label: t("step_send") },
    { icon: CheckCircle2, label: t("step_done") },
  ];

  return (
    <div className="h-dvh overflow-hidden flex flex-col bg-background pt-safe pb-safe px-5">
      <WelcomeCard />
      {/* Center everything vertically */}
      <div className="flex-1 flex flex-col items-center justify-center gap-8">
        {/* Title */}
        <div className="flex flex-col items-center">
          <h1 className="text-[32px] leading-none font-semibold tracking-tight text-center">
            Sign <span className="text-muted-foreground/50 font-light">&</span> Go
          </h1>
          <span className="text-[13px] text-muted-foreground/50 font-light tracking-tight self-end mt-0.5">
            By SSPP
          </span>
          <Link
            to="/settings"
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-card border border-border text-[11px] font-medium text-foreground/75 shadow-[var(--shadow-soft)]"
          >
            {isPremium ? (
              <>
                <Crown className="h-3 w-3 text-primary" />
                <span>{t("home_premium_badge")}</span>
              </>
            ) : (
              <span>{t("home_free_remaining", { remaining: String(remaining) })}</span>
            )}
          </Link>
        </div>


        {/* Flow */}
        <div className="flex flex-col items-center">
          <p className="text-[12px] text-muted-foreground uppercase tracking-widest mb-5">
            {t("howItWorks")}
          </p>
          <ol className="flex flex-col items-center gap-0.5">
            {steps.map((s, i) => {
              const Icon = s.icon;
              return (
                <li key={s.label} className="flex flex-col items-center">
                  <div className="flex items-center gap-3 py-1.5">
                    <div className="relative h-12 w-12 rounded-full bg-card border border-white/40 shadow-[var(--shadow-soft)] flex items-center justify-center">
                      <span className="absolute -top-1 -left-1 h-4.5 w-4.5 rounded-full bg-primary text-primary-foreground text-[9px] font-semibold flex items-center justify-center ring-2 ring-background">
                        {i + 1}
                      </span>
                      <Icon className="h-[18px] w-[18px] text-primary" strokeWidth={1.75} />
                    </div>
                    <span className="text-[15px] font-medium tracking-tight text-foreground/85 w-20">
                      {s.label}
                    </span>
                  </div>
                  {i < steps.length - 1 && (
                    <ArrowDown
                      className="h-3.5 w-3.5 text-foreground/55 my-0.5"
                      strokeWidth={1.5}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* Trust tagline */}
      <p className="text-center text-[8px] text-muted-foreground/60 tracking-wide pb-1 max-w-[220px] mx-auto">
        {t("appTagline")}
      </p>

      {/* CTA */}
      <div className="flex flex-col items-center gap-2 pt-2 pb-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,.pdf"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setFileError(null);
            try {
              if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) {
                setBusy(t("processingPdf", { current: "0", total: "?" }));
                let pages: string[];
                try {
                  pages = await pdfFileToImages(file, {
                    onProgress: (current, total) => {
                      if (total > MAX_PDF_PAGES) return;
                      setBusy(t("processingPdf", { current: String(current), total: String(total) }));
                    },
                  });
                } catch {
                  setBusy(null);
                  setFileError(t("pdfReadError"));
                  return;
                }
                if (pages.length === 0) {
                  setBusy(null);
                  return;
                }
                if (pages.length > MAX_PDF_PAGES) {
                  setBusy(null);
                  setFileError(t("pdfTooManyPages", { max: String(MAX_PDF_PAGES) }));
                  return;
                }
                scanStore.clear("new imported pdf");
                scanStore.set({ pages, imageDataUrl: pages[0] });
                navigate({ to: "/preview" });
                return;
              }
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result as string;
                scanStore.clear("new imported image");
                scanStore.set({ pages: [dataUrl], imageDataUrl: dataUrl });
                navigate({ to: "/preview" });
              };
              reader.readAsDataURL(file);
            } finally {
              e.target.value = "";
            }
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!!busy}
          className="block group w-full max-w-[240px] disabled:opacity-60"
        >
          <div className="rounded-xl bg-primary text-primary-foreground h-11 px-6 shadow-[var(--shadow-card)] transition active:scale-[0.98] flex items-center justify-center gap-2.5">
            {busy ? (
              <Loader2 className="h-[18px] w-[18px] shrink-0 opacity-90 animate-spin" strokeWidth={1.75} />
            ) : (
              <FileUp className="h-[18px] w-[18px] shrink-0 opacity-90" strokeWidth={1.75} />
            )}
            <span className="text-[15px] font-semibold tracking-tight whitespace-nowrap">{busy ?? t("attachFile")}</span>
          </div>
        </button>
        {fileError && (
          <p className="text-xs text-destructive text-center px-4">{fileError}</p>
        )}

        <div className="flex items-center justify-center gap-2 w-full">
          {/* Settings — vänster */}
          <Link to="/settings" className="block group">
            <div className="rounded-xl bg-card text-muted-foreground h-11 w-12 flex items-center justify-center shadow-[var(--shadow-soft)] border border-border transition active:scale-[0.98]">
              <SettingsIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
            </div>
          </Link>

          {/* Skanna — i mitten */}
          <Link to="/scan" className="block group w-full max-w-[240px]">
            <div className="rounded-xl bg-primary text-primary-foreground h-11 px-6 shadow-[var(--shadow-card)] transition active:scale-[0.98] flex items-center justify-center gap-2.5">
              <ScanLine className="h-[18px] w-[18px] shrink-0 opacity-90" strokeWidth={1.75} />
              <span className="text-[15px] font-semibold tracking-tight whitespace-nowrap">{t("scanDocument")}</span>
            </div>
          </Link>

          {/* Språkväxlare */}
          <button
            type="button"
            onClick={toggle}
            aria-label={t("changeLanguage")}
            className="flex flex-col items-center justify-center rounded-xl bg-card text-muted-foreground h-11 w-12 shadow-[var(--shadow-soft)] border border-border transition active:scale-[0.98]"
          >
            <Globe className="h-[18px] w-[18px] shrink-0" strokeWidth={1.75} />
            <span className="text-[7px] font-semibold tracking-wide mt-0.5">
              {lang === "sv" ? (
                <>
                  <span className="text-foreground">SV</span>
                  <span> | </span>
                  <span className="opacity-50">EN</span>
                </>
              ) : (
                <>
                  <span className="opacity-50">SV</span>
                  <span> | </span>
                  <span className="text-foreground">EN</span>
                </>
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
