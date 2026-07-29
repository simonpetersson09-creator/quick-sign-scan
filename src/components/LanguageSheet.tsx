import { useState } from "react";
import { Drawer as DrawerPrimitive } from "vaul";
import { Globe, Check } from "lucide-react";
import { useLang, LANGUAGES, type Lang } from "@/lib/i18n";

/**
 * iOS-style language picker: circular button + bottom sheet.
 * Purely presentational — language state stays in the i18n provider.
 */
export function LanguageSheet() {
  const { lang, setLang, t } = useLang();
  const [open, setOpen] = useState(false);

  function pick(code: Lang) {
    setLang(code);
    setOpen(false);
  }

  return (
    <DrawerPrimitive.Root open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
      <DrawerPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={t("changeLanguage")}
          className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full bg-card text-foreground shadow-[var(--shadow-soft)] border border-border transition active:scale-[0.96]"
        >
          <Globe className="h-[18px] w-[18px]" strokeWidth={1.75} />
          <span className="mt-[1px] text-[9px] font-semibold tracking-wide uppercase">
            {lang}
          </span>
        </button>
      </DrawerPrimitive.Trigger>

      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/30 backdrop-blur-[2px]" />
        <DrawerPrimitive.Content className="fixed inset-x-0 bottom-0 z-50 flex h-[60dvh] flex-col rounded-t-[24px] bg-card outline-none">
          {/* Drag handle */}
          <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-muted-foreground/25" />

          <DrawerPrimitive.Title className="px-6 pt-4 pb-3 text-[17px] font-semibold tracking-tight text-foreground text-center">
            {t("chooseLanguage")}
          </DrawerPrimitive.Title>

          <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-safe">
            <ul className="pb-6">
              {LANGUAGES.map((l) => {
                const active = l.code === lang;
                return (
                  <li key={l.code}>
                    <button
                      type="button"
                      onClick={() => pick(l.code)}
                      aria-current={active ? "true" : undefined}
                      className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-xl px-4 text-left transition active:bg-muted/60"
                    >
                      <span
                        className={
                          active
                            ? "text-[17px] font-semibold tracking-tight text-foreground"
                            : "text-[17px] font-normal tracking-tight text-foreground/80"
                        }
                      >
                        {l.nativeName}
                      </span>
                      {active && <Check className="h-5 w-5 shrink-0 text-primary" strokeWidth={2.5} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  );
}
