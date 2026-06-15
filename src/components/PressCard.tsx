import type { ReactNode } from "react";

/**
 * A printed card on cream stock: flat fill, 2.5px ink border, hard press-offset
 * shadow. The base surface for panels, hero label, and content blocks.
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
      className={`rounded-sm border-[2.5px] border-ink bg-cream shadow-press ${className}`}
    >
      {children}
    </div>
  );
}
