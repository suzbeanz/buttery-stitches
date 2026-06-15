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

export default function Stamp({
  variant = "outline",
  className = "",
  children,
}: {
  variant?: Variant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-block rounded-sm border-[1.5px] px-2.5 py-1 font-mono text-[11px] uppercase tracking-[0.1em] ${VARIANT[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
