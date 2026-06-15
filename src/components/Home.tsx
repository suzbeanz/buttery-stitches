import { Image as ImageIcon, Type, Eye } from "lucide-react";
import Footer from "./Footer";

/**
 * Marketing homepage — modern, compact, and confident. One punchy hero, a tight
 * three-up of what it does, a one-line how-it-works, then the footer. Lean
 * butter-and-navy branding; plain language so a first-timer gets it instantly.
 */
export default function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-navy text-cream">
      {/* Hero */}
      <header className="relative isolate overflow-hidden">
        {/* warm glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(900px 480px at 50% -10%, rgba(249,233,166,0.28), transparent 60%)",
          }}
        />
        <div className="mx-auto flex max-w-4xl flex-col items-center px-6 pt-20 pb-14 text-center sm:pt-28">
          <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-butter-200/25 bg-butter-200/10 px-4 py-1.5 text-xs font-medium text-butter-200">
            🧈 Free · open source · runs in your browser
          </span>
          <h1 className="wordmark text-5xl font-semibold leading-[1.05] text-butter-200 sm:text-7xl">
            Buttery Stitches
          </h1>
          <p className="mt-5 max-w-xl text-lg text-cream/75 sm:text-2xl">
            Turn your pictures and words into machine-embroidery files —
            pro-grade digitizing, made for everyone.
          </p>
          <button
            onClick={onStart}
            className="mt-9 inline-flex items-center gap-2 rounded-full bg-butter-200 px-9 py-4 text-lg font-semibold text-navy shadow-butter transition-transform hover:scale-[1.03]"
          >
            Start stitching 🧈
          </button>
          <p className="mt-3 text-sm text-cream/45">
            No sign-up. Your work never leaves your computer.
          </p>

          {/* three-up: what it does */}
          <div className="mt-16 grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-3">
            <Card
              Icon={ImageIcon}
              title="Picture → stitches"
              body="Drop in a logo or line art and get clean, machine-ready stitches."
            />
            <Card
              Icon={Type}
              title="Add words"
              body="Stitch a name or message with curated fonts and crisp lettering."
            />
            <Card
              Icon={Eye}
              title="Preview & export"
              body="See it in the hoop, then save to PES, DST, JEF, EXP, or VP3."
            />
          </div>
        </div>
      </header>

      {/* how it works — one compact line */}
      <section className="border-t border-cream/10 bg-navy-dark/40 py-10">
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 sm:flex-row sm:items-start sm:justify-between">
          <Step n={1} title="Start" body="Upload a picture, type words, or draw." />
          <Step n={2} title="Stitch" body="It auto-converts using best practices." />
          <Step n={3} title="Refine" body="Tweak color, size, and stitch style." />
          <Step n={4} title="Export" body="Send the file to your machine." />
        </div>
      </section>

      <div className="mx-auto max-w-2xl px-6 py-10 text-center text-sm text-cream/55">
        Pro digitizing software can cost hundreds of dollars. Buttery Stitches is
        a free, open-source alternative that runs entirely in your browser —
        named, with love, after a very good girl called Butters.
      </div>

      <div className="mt-auto bg-cream text-navy">
        <Footer />
      </div>
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
    <div className="rounded-2xl border border-cream/10 bg-cream/[0.04] p-5 backdrop-blur-sm">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-butter-200 text-navy">
        <Icon size={20} />
      </div>
      <h3 className="mt-3 font-semibold text-cream">{title}</h3>
      <p className="mt-1 text-sm text-cream/60">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-butter-200 text-sm font-bold text-navy">
        {n}
      </span>
      <div>
        <div className="font-semibold text-butter-200">{title}</div>
        <div className="text-sm text-cream/60">{body}</div>
      </div>
    </div>
  );
}
