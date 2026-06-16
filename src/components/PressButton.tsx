import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * A "printed" button: flat fill, 2.5px ink border, hard press-offset shadow that
 * collapses when pressed. Oswald caps. No soft glow — it should feel stamped.
 *   primary — Press Blue fill (the main action)
 *   stamp   — Stamp Red fill (reserve for ONE accent action, e.g. Export)
 *   ghost   — ink outline on transparent
 * Pass `href` to render a link styled identically.
 */
type Variant = "primary" | "stamp" | "ghost";

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-cream border-ink shadow-press hover:bg-ink-deep before:border-cream/55",
  stamp: "bg-stamp text-cream border-stamp shadow-press-stamp hover:brightness-95 before:border-cream/60",
  ghost: "bg-cream text-ink border-ink shadow-press hover:bg-butter-50 before:border-ink/35",
};

// A dashed "stitch" line is run just inside the border (the ::before ring), so
// every button reads like a sewn-on patch.
const BASE =
  "relative inline-flex items-center justify-center gap-2 rounded-sm border-[2.5px] px-5 py-2.5 font-label text-sm font-semibold uppercase tracking-[0.14em] transition-[transform,box-shadow,background-color] active:translate-y-[3px] active:shadow-none disabled:opacity-50 before:pointer-events-none before:absolute before:inset-[3px] before:rounded-[2px] before:border before:border-dashed before:content-['']";

export default function PressButton({
  variant = "primary",
  className = "",
  href,
  children,
  ...props
}: {
  variant?: Variant;
  href?: string;
  children: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const cls = `${BASE} ${VARIANT[variant]} ${className}`;
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" className={cls}>
        {children}
      </a>
    );
  }
  return (
    <button {...props} className={cls}>
      {children}
    </button>
  );
}
