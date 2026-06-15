/**
 * The tablespoon-ruler device from the brand guide: a navy top rule with navy
 * major (1/16) and minor (1/64) ticks hanging beneath it, printed straight on
 * the cream stock. Used as the section divider throughout the app — the signature
 * sewing-table nod that ties the editor to the homepage.
 */
const NAVY = "#20305F";

export default function RulerStrip({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`relative h-4 w-full shrink-0 border-t-2 border-navy ${className}`}
    >
      {/* major ticks */}
      <div
        className="absolute inset-x-0 top-0 h-[13px]"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, ${NAVY} 0 1.4px, transparent 1.4px 100%)`,
          backgroundSize: "calc(100% / 16) 13px",
        }}
      />
      {/* minor ticks */}
      <div
        className="absolute inset-x-0 top-0 h-[7px] opacity-50"
        style={{
          backgroundImage: `repeating-linear-gradient(to right, ${NAVY} 0 1px, transparent 1px 100%)`,
          backgroundSize: "calc(100% / 64) 7px",
        }}
      />
    </div>
  );
}
