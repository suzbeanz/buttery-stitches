import type { ReactNode } from "react";

/**
 * A small printed stamp/ticket — for file formats (PES, DST…), grades, and
 * metadata. Space Mono caps, square corners.
 *   outline — ink border (default)
 *   solid   — ink fill
 *   red     — Stamp Red border
 */
type Variant = "outline" | "solid" | "red";

const VARIANT: Record<Variant, string> = {
  outline: "border-ink text-ink",
  solid: "border-ink bg-ink text-cream",
  red: "border-stamp text-stamp",
};

/** Hover-fill (when a `tip` is set): an outline stamp inks in like a pressed mark. */
const HOVER: Record<Variant, string> = {
  outline: "hover:bg-ink hover:text-cream",
  solid: "hover:bg-ink-deep",
  red: "hover:bg-stamp hover:text-cream",
};

export default function Stamp({
  variant = "outline",
  className = "",
  tip,
  children,
}: {
  variant?: Variant;
  className?: string;
  /** when set, the stamp inks in on hover and shows this label as a tooltip. */
  tip?: string;
  children: ReactNode;
}) {
  return (
    <span
      data-tip={tip}
      data-tip-side="top"
      className={`inline-block rounded-sm border-[1.5px] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.1em] ${VARIANT[variant]} ${
        tip ? `cursor-default transition-colors ${HOVER[variant]}` : ""
      } ${className}`}
    >
      {children}
    </span>
  );
}
