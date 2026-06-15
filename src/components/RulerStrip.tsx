/**
 * The butter-stick ruler motif as a thin horizontal divider: a butter band
 * printed with navy minor + major ticks. Used as label-style trim around the app
 * (under the top bar) and on the homepage, tying the whole surface to the rulers
 * inside the editor.
 */
export default function RulerStrip({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`h-3 w-full shrink-0 border-b border-navy/40 ${className}`}
      style={{
        background: `
          repeating-linear-gradient(90deg, #16234A 0 1px, transparent 1px 32px) bottom / 100% 7px no-repeat,
          repeating-linear-gradient(90deg, rgba(22,35,74,0.6) 0 1px, transparent 1px 8px) bottom / 100% 4px no-repeat,
          #F9E9A6`,
      }}
    />
  );
}
