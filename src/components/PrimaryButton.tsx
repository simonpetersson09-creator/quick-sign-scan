import { ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
}

export const PrimaryButton = forwardRef<HTMLButtonElement, Props>(
  ({ variant = "primary", className, ...props }, ref) => {
    const base =
      "w-full h-14 rounded-2xl text-[17px] font-semibold tracking-tight transition active:scale-[0.985] disabled:opacity-50 disabled:pointer-events-none";
    const styles =
      variant === "primary"
        ? "bg-primary text-primary-foreground shadow-[var(--shadow-soft)] hover:opacity-95"
        : variant === "secondary"
        ? "bg-secondary text-secondary-foreground hover:bg-muted"
        : "bg-transparent text-foreground/70 hover:bg-secondary";
    return <button ref={ref} className={cn(base, styles, className)} {...props} />;
  },
);
PrimaryButton.displayName = "PrimaryButton";
