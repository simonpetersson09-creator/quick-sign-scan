import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useT } from "@/lib/i18n";

interface Props {
  title?: string;
  back?: string;
  children: ReactNode;
  rightSlot?: ReactNode;
}

export function AppShell({ title, back, children, rightSlot }: Props) {
  const t = useT();
  return (
    <div className="min-h-dvh flex flex-col bg-background">
      {(title || back) && (
        <header className="pt-safe px-5 pb-3 relative flex items-center justify-center min-h-[44px]">
          {back && (
            <Link
              to={back}
              className="absolute left-5 inline-flex items-center justify-center h-10 w-10 rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-soft)] hover:opacity-95 active:scale-[0.97] transition"
              aria-label={t("back")}
            >
              <ChevronLeft className="h-5 w-5" />
            </Link>
          )}
          <h1 className="text-[17px] font-semibold tracking-tight text-center">
            {title}
          </h1>
          {rightSlot && <div className="absolute right-5">{rightSlot}</div>}
        </header>
      )}
      <main className="flex-1 flex flex-col px-5 pb-safe">{children}</main>
    </div>
  );
}
