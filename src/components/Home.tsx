import { Image as ImageIcon, Type, Pencil, Eye, Download, Wand2 } from "lucide-react";
import Footer from "./Footer";

/**
 * Marketing homepage shown in front of the editor. Plain language, big targets,
 * and a clear path to "Start stitching" so a first-timer — including someone who
 * has never touched digitizing software — knows exactly what this is and how to
 * begin. Lean butter-and-navy branding, no jargon.
 */
export default function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="h-full overflow-y-auto bg-cream text-navy">
      {/* Hero */}
      <header className="mx-auto max-w-3xl px-6 pt-16 pb-12 text-center sm:pt-24">
        <div className="mb-4 text-5xl" aria-hidden>
          🧈
        </div>
        <h1 className="wordmark text-4xl font-semibold text-navy sm:text-6xl">
          Buttery Stitches
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-navy/70 sm:text-xl">
          Turn your pictures and words into machine-embroidery stitch files —
          free, in your browser. The power of pricey digitizing software, made
          for everyone.
        </p>
        <button
          onClick={onStart}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-navy px-8 py-4 text-lg font-semibold text-butter-200 shadow-butter transition-colors hover:bg-navy-light"
        >
          Start stitching 🧈
        </button>
        <p className="mt-3 text-sm text-navy/45">
          No sign-up, no download. Your work stays on your computer.
        </p>
      </header>

      {/* What it does */}
      <section className="mx-auto max-w-5xl px-6 py-12">
        <h2 className="text-center font-butter text-2xl font-semibold sm:text-3xl">
          What Buttery Stitches does
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Feature
            Icon={ImageIcon}
            title="Turn a picture into stitches"
            body="Drop in a logo or piece of line art and it becomes clean, machine-ready stitches automatically."
          />
          <Feature
            Icon={Type}
            title="Add words"
            body="Stitch a name or message with curated fonts and crisp lettering — satin or solid fill."
          />
          <Feature
            Icon={Pencil}
            title="Edit like a pro"
            body="Premade shapes, draggable points, layers, snapping, and undo — without the steep learning curve."
          />
          <Feature
            Icon={Wand2}
            title="Clean, deliberate stitching"
            body="Underlay, tie-offs, and safe stitch lengths follow embroidery best practices, so designs sew reliably."
          />
          <Feature
            Icon={Eye}
            title="Preview in the hoop"
            body="See your design inside a real hoop on your fabric color, and watch it redraw stitch by stitch."
          />
          <Feature
            Icon={Download}
            title="Export to your machine"
            body="Save to PES, DST, JEF, EXP, or VP3 — the formats home and commercial machines use."
          />
        </div>
      </section>

      {/* How to use it */}
      <section className="bg-butter-50 py-14">
        <div className="mx-auto max-w-3xl px-6">
          <h2 className="text-center font-butter text-2xl font-semibold sm:text-3xl">
            How to use it
          </h2>
          <ol className="mt-8 space-y-5">
            <Step
              n={1}
              title="Start with a picture, words, or a shape"
              body="Pick how you want to begin from the welcome screen — upload an image, type some text, or draw."
            />
            <Step
              n={2}
              title="Let it become stitches"
              body="Buttery Stitches converts your art into clean stitches and tidies them up using embroidery best practices."
            />
            <Step
              n={3}
              title="Make it yours"
              body="Adjust colors, size, and stitch style. Add a satin outline, nudge points, and reorder layers."
            />
            <Step
              n={4}
              title="Preview, then export"
              body="Check it inside the hoop, watch it stitch, then export the file your embroidery machine reads."
            />
          </ol>
          <div className="mt-10 text-center">
            <button
              onClick={onStart}
              className="inline-flex items-center gap-2 rounded-full bg-navy px-8 py-4 text-lg font-semibold text-butter-200 shadow-butter transition-colors hover:bg-navy-light"
            >
              Start stitching 🧈
            </button>
          </div>
        </div>
      </section>

      {/* About */}
      <section className="mx-auto max-w-3xl px-6 py-14 text-center">
        <h2 className="font-butter text-2xl font-semibold sm:text-3xl">About</h2>
        <p className="mx-auto mt-5 max-w-2xl text-navy/70">
          Professional digitizing software can cost hundreds of dollars, which
          puts it out of reach for a lot of makers. Buttery Stitches is a free,
          open-source alternative that runs entirely in your browser — nothing to
          install, nothing uploaded to a server. It's built to be genuinely easy:
          if you can type a word or open a picture, you can make something you're
          proud to stitch.
        </p>
        <p className="mx-auto mt-4 max-w-2xl text-navy/70">
          It's named, with love, after a very good girl named Butters.
        </p>
      </section>

      <Footer />
    </div>
  );
}

function Feature({
  Icon,
  title,
  body,
}: {
  Icon: typeof ImageIcon;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-2xl border border-navy/10 bg-white p-5 shadow-card">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-butter-100 text-navy">
        <Icon size={22} />
      </div>
      <h3 className="mt-3 text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-navy/65">{body}</p>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-navy text-base font-semibold text-butter-200">
        {n}
      </span>
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-0.5 text-navy/65">{body}</p>
      </div>
    </li>
  );
}
