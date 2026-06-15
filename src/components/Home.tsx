import { Image as ImageIcon, Type, Eye, Star } from "lucide-react";
import Footer from "./Footer";

/**
 * Homepage styled like a printed butter wrapper: navy press-ink on cream paper
 * is the primary look, a "salted" red is the occasional accent, butter-yellow is
 * a tertiary highlight, and the butter-stick ruler tick lines are used liberally
 * as dividers and trim. Compact and confident — the wrapper for the whole app.
 */
const RED = "#C0392B"; // the "salted" accent

export default function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="h-full overflow-y-auto bg-cream text-navy">
      <RulerStrip />

      {/* Printed label */}
      <div className="mx-auto max-w-3xl px-5 py-10 sm:py-14">
        <div className="relative border-2 border-navy bg-cream p-6 shadow-butter sm:p-10">
          {/* inner hairline rule, like a wrapper's double border */}
          <div className="pointer-events-none absolute inset-2 border border-navy/30" />

          <div className="relative text-center">
            {/* salted stamp */}
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-cream"
              style={{ backgroundColor: RED }}
            >
              <Star size={11} fill="currentColor" /> Lightly Salted · Est. 2026
            </span>

            <div className="mt-5 text-5xl" aria-hidden>
              🧈
            </div>
            <h1 className="wordmark mt-1 text-5xl font-semibold leading-[1.02] text-navy sm:text-7xl">
              Buttery Stitches
            </h1>
            <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.32em] text-navy/70">
              Pure · Open Source · Churned in your browser
            </p>

            <p className="mx-auto mt-5 max-w-md text-base text-navy/75 sm:text-lg">
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
          </div>
        </div>
      </div>

      <RulerStrip />

      {/* What's inside */}
      <section className="mx-auto max-w-4xl px-5 py-12">
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
      <section className="mx-auto max-w-3xl px-5 py-12">
        <Eyebrow>How to use it</Eyebrow>
        <ol className="mt-6 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
          <Step n={1} title="Start" body="Upload a picture, type words, or draw." />
          <Step n={2} title="Stitch" body="It auto-converts using embroidery best practices." />
          <Step n={3} title="Refine" body="Tweak color, size, and stitch style." />
          <Step n={4} title="Export" body="Send the file to your embroidery machine." />
        </ol>
        <p className="mx-auto mt-9 max-w-xl text-center text-sm text-navy/60">
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
          repeating-linear-gradient(90deg, #16234A 0 1px, transparent 1px 36px) bottom / 100% 11px no-repeat,
          repeating-linear-gradient(90deg, rgba(22,35,74,0.7) 0 1px, transparent 1px 9px) bottom / 100% 6px no-repeat,
          #F9E9A6`,
      }}
    />
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center gap-3 text-center">
      <span className="h-px w-8" style={{ backgroundColor: RED }} />
      <h2 className="font-butter text-2xl font-semibold text-navy sm:text-3xl">
        {children}
      </h2>
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
