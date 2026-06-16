import type { ReactNode } from "react";

/**
 * A printed card on warm cream stock: fibrous paper grain, a top sheen, and a
 * pressed depth (hard press-offset shadow + thin inset highlight/shade), with a
 * 2.5px ink border and square corners. The base surface for panels, the hero
 * label, and content blocks. Texture + depth come from the `.paper-card` class.
 */
export default function PressCard({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`paper-card rounded-sm border-[2.5px] border-ink ${className}`}
    >
      {children}
    </div>
  );
}
