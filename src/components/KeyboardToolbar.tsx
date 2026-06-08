import { useKeyboard } from "@/hooks/useKeyboard";
import { useT } from "@/lib/i18n";
import { isNative } from "@/lib/native-init";
import { cn } from "@/lib/utils";

export function KeyboardToolbar() {
  const t = useT();
  const { visible, dismiss } = useKeyboard();

  if (!isNative() || !visible) return null;

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-[100]",
        "bg-background/95 backdrop-blur-sm border-t border-border",
        "flex items-center justify-end px-4",
        "h-11"
      )}
    >
      <button
        type="button"
        onClick={dismiss}
        className="text-[17px] font-semibold text-primary active:opacity-70 transition-opacity"
      >
        {t("doneButton")}
      </button>
    </div>
  );
}
