import { Image as ImageIcon, Type, Eye } from "lucide-react";
import Footer from "./Footer";

/**
 * The whole homepage is one printed butter label: a butter-yellow wrapper around
 * a cream label face, printed in navy press-ink (primary) with a "salted" red
 * accent (occasional) and butter-yellow highlights (tertiary). A creamery oval
 * seal, a ribbon banner, corner ornaments, and the butter-stick ruler tick lines
 * tie it together — and to the rulers inside the app.
 */
const RED = "#C0392B"; // the "salted" accent
const NAVY = "#16234A";

export default function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="h-full overflow-y-auto bg-butter-200 p-3 sm:p-6">
      {/* The label face */}
      <div className="relative mx-auto max-w-3xl border-[3px] border-navy bg-cream shadow-butter">
        <div className="pointer-events-none absolute inset-[6px] border border-navy/40" />
        <Corner pos="left-1 top-1" />
        <Corner pos="right-1 top-1" />
        <Corner pos="left-1 bottom-1" />
        <Corner pos="right-1 bottom-1" />

        <RulerStrip />

        {/* Hero seal */}
        <header className="px-6 pt-10 pb-8 text-center sm:px-10">
          <Seal />
          <div className="mx-auto mt-5 inline-block">
            <Ribbon>Lightly Salted · Est. 2026</Ribbon>
          </div>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.34em] text-navy/70">
            Pure · Open Source · Churned in your browser
          </p>
          <p className="mx-auto mt-4 max-w-md text-base text-navy/75 sm:text-lg">
            Turn your pictures and words into machine-embroidery files —
            pro-grade digitizing, spread thick and free for everyone.
          </p>
          <button
            onClick={onStart}
            className="mt-7 inline-flex items-center gap-2 rounded-full bg-navy px-9 py-3.5 text-lg font-semibold text-butter-200 shadow-butter transition-transform hover:scale-[1.03]"
          >
            Start stitching 🧈
          </button>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-navy/45">
            Net wt. free · No sign-up · Stays on your machine
          </p>
        </header>

        <RulerStrip />

        {/* What's inside */}
        <section className="px-6 py-10 sm:px-10">
          <Eyebrow>What&apos;s inside</Eyebrow>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Card
              Icon={ImageIcon}
              title="Picture → stitches"
              body="Drop in a logo or line art and get clean, machine-ready stitches."
            />
            <Card
              Icon={Type}
              title="Add words"
              body="Stitch a name or message with curated fonts and crisp satin lettering."
            />
            <Card
              Icon={Eye}
              title="Preview & export"
              body="See it in the hoop, then save to PES, DST, JEF, EXP, or VP3."
            />
          </div>
        </section>

        <RulerStrip />

        {/* How to use it */}
        <section className="px-6 py-10 sm:px-10">
          <Eyebrow>How to use it</Eyebrow>
          <ol className="mx-auto mt-6 grid max-w-xl grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            <Step n={1} title="Start" body="Upload a picture, type words, or draw." />
            <Step n={2} title="Stitch" body="It auto-converts using embroidery best practices." />
            <Step n={3} title="Refine" body="Tweak color, size, and stitch style." />
            <Step n={4} title="Export" body="Send the file to your embroidery machine." />
          </ol>
          <p className="mx-auto mt-8 max-w-xl text-center text-sm text-navy/60">
            Pro digitizing software can cost hundreds of dollars. Buttery Stitches
            is a free, open-source alternative that runs entirely in your browser —
            named, with love, after a very good girl called Butters.
          </p>
          <div className="mt-7 text-center">
            <button
              onClick={onStart}
              className="inline-flex items-center gap-2 rounded-full border-2 border-navy px-7 py-3 text-base font-semibold text-navy transition-colors hover:bg-butter-200"
            >
              Start stitching 🧈
            </button>
          </div>
        </section>

        <RulerStrip />
        <Footer />
      </div>
    </div>
  );
}

/** Creamery oval seal: a navy ring with curved top text and the wordmark. */
function Seal() {
  return (
    <div className="relative mx-auto w-full max-w-md">
      <svg viewBox="0 0 320 196" className="w-full" role="img" aria-label="Buttery Stitches creamery seal">
        <ellipse cx="160" cy="98" rx="152" ry="92" fill="none" stroke={NAVY} strokeWidth="3" />
        <ellipse cx="160" cy="98" rx="142" ry="82" fill="none" stroke={NAVY} strokeWidth="1" />
        <path id="seal-top" d="M 40 98 A 120 62 0 0 1 280 98" fill="none" />
        <path id="seal-bottom" d="M 280 98 A 120 62 0 0 1 40 98" fill="none" />
        <text fill={NAVY} fontSize="13" fontWeight="700" letterSpacing="3.5">
          <textPath href="#seal-top" startOffset="50%" textAnchor="middle">
            ★ PURE CREAMERY ★ EMBROIDERY STUDIO ★
          </textPath>
        </text>
        <text fill={NAVY} fontSize="11" fontWeight="700" letterSpacing="3">
          <textPath href="#seal-bottom" startOffset="50%" textAnchor="middle">
            FREE · OPEN SOURCE · IN YOUR BROWSER
          </textPath>
        </text>
      </svg>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl sm:text-5xl" aria-hidden>
          🧈
        </span>
        <span className="wordmark mt-0.5 text-2xl font-semibold leading-none text-navy sm:text-4xl">
          Buttery Stitches
        </span>
      </div>
    </div>
  );
}

/** A small red banner ribbon — the "salted" accent. */
function Ribbon({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-block px-4 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-cream"
      style={{ backgroundColor: RED }}
    >
      {children}
    </span>
  );
}

/** Butter-stick ruler motif: a butter band printed with navy minor + major ticks. */
function RulerStrip() {
  return (
    <div
      aria-hidden
      className="h-5 w-full border-y border-navy/40"
      style={{
        background: `
          repeating-linear-gradient(90deg, ${NAVY} 0 1px, transparent 1px 36px) bottom / 100% 11px no-repeat,
          repeating-linear-gradient(90deg, rgba(22,35,74,0.7) 0 1px, transparent 1px 9px) bottom / 100% 6px no-repeat,
          #F9E9A6`,
      }}
    />
  );
}

/** A rotated navy diamond tucked into a label corner. */
function Corner({ pos }: { pos: string }) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute ${pos} z-10 h-2.5 w-2.5 rotate-45 bg-navy`}
    />
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-3 text-center">
      <span className="h-px w-8" style={{ backgroundColor: RED }} />
      <h2 className="font-butter text-2xl font-semibold text-navy sm:text-3xl">{children}</h2>
      <span className="h-px w-8" style={{ backgroundColor: RED }} />
    </div>
  );
}

function Card({
  Icon,
  title,
  body,
}: {
  Icon: typeof ImageIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="border-2 border-navy bg-cream p-5">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-butter-200 text-navy">
        <Icon size={22} />
      </div>
      <h3 className="mt-3 text-lg font-semibold text-navy">{title}</h3>
      <p className="mt-1 text-sm text-navy/65">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-navy bg-butter-200 text-base font-bold text-navy">
        {n}
      </span>
      <div>
        <div className="font-semibold text-navy">{title}</div>
        <div className="text-sm text-navy/65">{body}</div>
      </div>
    </li>
  );
}
