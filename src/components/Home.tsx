import { Image as ImageIcon, Type, Eye } from "lucide-react";
import Footer from "./Footer";

/**
 * Homepage as a printed butter label (per the reference): the whole surface is
 * butter-yellow, everything is pressed in navy ink with a "salted" red accent,
 * the butter-stick ruler doubles as the nav (with red Tbsp measurements), the
 * body is set in monospace like a wrapper, and a "NET WT." line signs the foot.
 */
const RED = "#C0392B";
const NAVY = "#16234A";

export default function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="relative h-full overflow-y-auto bg-butter-200 text-navy">
      {/* faint corner sparkles, like the reference */}
      <Sparkle className="left-3 top-3" />
      <Sparkle className="right-3 bottom-3" />

      <div className="mx-auto max-w-4xl px-5 py-12 sm:py-16">
        {/* Headline */}
        <h1 className="wordmark text-center text-5xl font-bold leading-[0.95] text-navy sm:text-7xl">
          Buttery Stitches
        </h1>
        <p className="mt-3 text-center text-sm font-bold uppercase tracking-[0.28em] text-navy/80 sm:text-base">
          Embroidery Digitizing — Made Simple
        </p>

        {/* Ruler nav with Tbsp measurements */}
        <RulerNav />

        <div className="mt-8 text-center">
          <button
            onClick={onStart}
            className="inline-flex items-center gap-2 rounded-full bg-navy px-9 py-3.5 text-lg font-semibold text-butter-200 shadow-butter transition-transform hover:scale-[1.03]"
          >
            Start stitching 🧈
          </button>
          <p className="mt-2 text-[11px] font-bold uppercase tracking-[0.18em] text-navy/50">
            Free · No sign-up · Stays on your machine
          </p>
        </div>

        {/* Two-column wrapper copy */}
        <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2">
          <Column title="Key Features" salted>
            <p>
              Turn flat logos and line art into clean, machine-ready stitches
              automatically. Add words in curated fonts with crisp satin
              lettering that follows every stroke.
            </p>
            <p>
              Drop in premade shapes, drag points, snap to guides, and reorder
              layers — a full editor without the steep learning curve. Everything
              runs in your browser; nothing is uploaded.
            </p>
            <div className="grid grid-cols-3 gap-2 pt-1 font-sans">
              <Pill Icon={ImageIcon} label="Pictures" />
              <Pill Icon={Type} label="Words" />
              <Pill Icon={Eye} label="Preview" />
            </div>
          </Column>

          <Column title="How It Works">
            <p>
              Start with a picture, some words, or a shape. Buttery Stitches
              converts it to stitches using embroidery best practices — underlay,
              tie-offs, and safe stitch lengths so designs sew reliably.
            </p>
            <p>
              Tweak color, size, and stitch style, preview it inside the hoop,
              then export to PES, DST, JEF, EXP, or VP3 — the formats home and
              commercial machines read.
            </p>
            <p className="text-navy/60">
              Pro digitizing software costs hundreds of dollars. This is a free,
              open-source alternative — named, with love, after a very good girl
              called Butters.
            </p>
          </Column>
        </div>

        {/* NET WT. signature */}
        <div className="mt-14 border-t-2 border-navy pt-6 text-center">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-navy">
            Net wt. free · 100% open source
          </p>
          <Footer />
        </div>
      </div>
    </div>
  );
}

/** The butter-stick ruler as a decorative divider, with red Tbsp measurements. */
function RulerNav() {
  const tbsp = 8;
  return (
    <div className="mx-auto mt-9 max-w-2xl select-none" aria-hidden>
      <svg viewBox="0 0 800 26" className="w-full">
        <line x1="3" y1="13" x2="797" y2="13" stroke={NAVY} strokeWidth="2" />
        {Array.from({ length: tbsp + 1 }).map((_, i) => {
          const x = 3 + (794 * i) / tbsp;
          const major = i === 0 || i === tbsp;
          return (
            <line
              key={i}
              x1={x}
              y1={major ? 3 : 6}
              x2={x}
              y2={major ? 23 : 20}
              stroke={NAVY}
              strokeWidth="2"
            />
          );
        })}
      </svg>

      <div
        className="grid text-center text-xs font-bold sm:text-sm"
        style={{ gridTemplateColumns: `repeat(${tbsp}, minmax(0, 1fr))`, color: RED }}
      >
        {Array.from({ length: tbsp }).map((_, i) => (
          <span key={i}>{i + 1} Tbsp</span>
        ))}
      </div>
    </div>
  );
}

function Column({
  title,
  salted,
  children,
}: {
  title: string;
  salted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-xl font-bold uppercase tracking-wide text-navy sm:text-2xl">
        {title}
        {salted && <span style={{ color: RED }}> *</span>}
      </h2>
      <div className="mt-3 space-y-3 font-mono text-sm leading-relaxed text-navy/85">
        {children}
      </div>
    </section>
  );
}

function Pill({ Icon, label }: { Icon: typeof ImageIcon; label: string }) {
  return (
    <div className="flex items-center gap-1.5 border-2 border-navy px-2 py-1.5 text-xs font-semibold text-navy">
      <Icon size={14} />
      {label}
    </div>
  );
}

function Sparkle({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute text-3xl text-navy/10 ${className}`}
    >
      ✦
    </span>
  );
}
