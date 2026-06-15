import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * A "printed" button: flat fill, 2.5px ink border, hard press-offset shadow that
 * collapses when pressed. Oswald caps. No soft glow — it should feel stamped.
 *   primary — Press Blue fill (the main action)
 *   stamp   — Stamp Red fill (reserve for ONE accent action, e.g. Export)
 *   ghost   — ink outline on transparent
 */
type Variant = "primary" | "stamp" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-cream border-ink shadow-press hover:bg-ink-deep",
  stamp: "bg-stamp text-cream border-stamp shadow-press-stamp hover:brightness-95",
  ghost: "bg-transparent text-ink border-ink hover:bg-ink/5",
};

export default function PressButton({
  variant = "primary",
  className = "",
  children,
  ...props
}: { variant?: Variant; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 rounded-sm border-[2.5px] px-5 py-2.5 font-label text-sm font-semibold uppercase tracking-[0.14em] transition-[transform,box-shadow,background-color] active:translate-y-[3px] active:shadow-none disabled:opacity-50 ${VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  );
}
