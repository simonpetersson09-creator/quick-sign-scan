import { useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Globe, Check } from "lucide-react";
import { useLang, LANGUAGES, type Lang } from "@/lib/i18n";
import { LanguageTip } from "@/components/LanguageTip";

/**
 * iOS-style language picker: circular button + compact floating popover
 * anchored above the button. Purely presentational — language state stays
 * in the i18n provider.
 */
export function LanguageSheet() {
  const { lang, setLang, t } = useLang();
  const [open, setOpen] = useState(false);

  function pick(code: Lang) {
    setLang(code);
    setOpen(false);
  }

  return (
    <div className="relative">
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
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
      </PopoverPrimitive.Trigger>

      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          side="top"
          align="end"
          sideOffset={10}
          collisionPadding={12}
          className="z-50 w-[280px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[20px] border border-border bg-card p-1.5 shadow-[var(--shadow-card)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=top]:slide-in-from-bottom-2"
        >
          <div
            className="max-h-[50dvh] overflow-y-auto overscroll-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <ul>
              {LANGUAGES.map((l) => {
                const active = l.code === lang;
                return (
                  <li key={l.code}>
                    <button
                      type="button"
                      onClick={() => pick(l.code)}
                      aria-current={active ? "true" : undefined}
                      className="flex min-h-[46px] w-full items-center justify-between gap-3 rounded-[14px] px-3.5 text-left transition active:bg-muted/60"
                    >
                      <span
                        className={
                          active
                            ? "text-[16px] font-semibold tracking-tight text-foreground"
                            : "text-[16px] font-normal tracking-tight text-foreground/80"
                        }
                      >
                        {l.nativeName}
                      </span>
                      {active && <Check className="h-[18px] w-[18px] shrink-0 text-primary" strokeWidth={2.5} />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
    <LanguageTip dismissed={open} />
    </div>
  );
}
