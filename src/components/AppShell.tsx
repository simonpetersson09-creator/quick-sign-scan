import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

interface Props {
  title?: string;
  back?: string;
  children: ReactNode;
  rightSlot?: ReactNode;
}

export function AppShell({ title, back, children, rightSlot }: Props) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      {(title || back) && (
        <header className="pt-safe px-5 pb-3 flex items-center gap-2">
          {back ? (
            <Link
              to={back}
              className="-ml-2 inline-flex items-center justify-center h-10 w-10 rounded-full text-foreground/70 hover:bg-secondary transition"
              aria-label="Tillbaka"
            >
              <ChevronLeft className="h-6 w-6" />
            </Link>
          ) : (
            <div className="w-2" />
          )}
          <h1 className="flex-1 text-[17px] font-semibold tracking-tight">
            {title}
          </h1>
          {rightSlot}
        </header>
      )}
      <main className="flex-1 flex flex-col px-5 pb-safe">{children}</main>
    </div>
  );
}
