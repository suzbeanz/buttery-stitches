import type { ReactNode } from "react";
import Tape from "./Tape";
import PressButton from "./PressButton";
import PressCard from "./PressCard";
import Stamp from "./Stamp";
import GradeStamp from "./GradeStamp";
import SectionHead from "./SectionHead";
import Footer from "./Footer";

/**
 * The homepage as a printed butter wrapper / editorial spread. Flat Press-Blue
 * ink on churned-butter stock; a tablespoon tape rules between every section and
 * a vertical rule runs down each section's margin as a consistent fixture. The
 * page is printed and still — the only motion is the "How It Works" tape, sewn
 * in stitch-by-stitch as it scrolls into view.
 */
export default function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="h-full overflow-y-auto">
      {/* HERO — the label */}
      <div className="mx-auto max-w-5xl px-6 pt-10 sm:pt-16">
        <PressCard className="relative overflow-hidden px-6 py-8 sm:px-10 sm:py-10">
          {/* Warm label-light behind the wordmark — lifts the type off the card. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-0"
            style={{
              background:
                "radial-gradient(58% 52% at 50% 46%, rgba(255,253,243,0.75), rgba(255,253,243,0) 72%)",
            }}
          />
          <div className="relative z-10 flex items-center justify-between border-b-[1.5px] border-foil pb-3 font-label text-[12px] font-semibold uppercase tracking-[0.22em] text-ink">
            <span>Open Source</span>
            <span>Net Wt. Free · 100% Free</span>
          </div>

          {/* Flanking seals — pinned to the card edges, shown only at lg+ where
              the card is wide enough to clear the big wordmark. */}
          <GradeStamp
            size={74}
            className="absolute left-6 top-1/2 z-10 hidden -translate-y-1/2 lg:block"
          />
          <GradeStamp
            size={74}
            rotate={7}
            top="Made"
            big="100"
            bottom="% Open"
            className="absolute right-6 top-1/2 z-10 hidden -translate-y-1/2 lg:block"
          />

          <div className="relative z-10 mt-8 text-center">
            <div className="mb-1.5 font-accent text-2xl italic text-stamp sm:text-3xl">
              Sweet &amp; Unsalted
            </div>
            <div
              className="font-display text-6xl uppercase leading-[0.95] tracking-wide text-ink sm:text-8xl sm:leading-none"
              style={{ textShadow: "0 1px 0 rgba(255,253,243,0.55), 0 3px 0 rgba(16,42,87,0.12)" }}
            >
              Buttery
              <br />
              Stitches
            </div>
            {/* Static stamp-red rule. */}
            <div className="mx-auto mt-5 h-[3px] w-44 max-w-[70%] rounded-full bg-stamp" />
            <div className="mt-5 font-label text-[12px] font-medium uppercase tracking-[0.4em] text-ink-deep sm:text-sm">
              Free Embroidery Digitizing
            </div>
          </div>

          <div className="relative z-10 mt-7 text-center font-mono text-[12px] uppercase tracking-[0.14em] text-char/80">
            Pictures, Words &amp; Shapes → Machine-Ready Stitches
          </div>
        </PressCard>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <PressButton onClick={onStart} className="text-base">
            Start Stitching
          </PressButton>
          <PressButton variant="ghost" href="https://github.com/suzbeanz/buttery-stitches">
            <GithubGlyph /> View on GitHub
          </PressButton>
        </div>
        <p className="mt-3 text-center font-mono text-[11px] uppercase tracking-[0.14em] text-char/60">
          Free · No sign-up · Stays on your machine
        </p>
      </div>

      <Tape unit="Tbsp" className="mx-auto mt-12 max-w-5xl px-6" />

      {/* 01 — THE SPREAD */}
      <Section no="Section 01 / Half Cup" title="The Spread" sub="What it does">
        <p className="max-w-2xl font-body text-[17px] leading-relaxed text-char">
          Pictures, words, and shapes become machine-ready embroidery — free,
          open-source, and churned right in your browser.{" "}
          <b className="text-ink">No AI, no guesswork:</b> every stitch is plain
          math and logic, measured and exact.
        </p>
        <p className="mt-4 max-w-2xl font-accent text-xl italic text-stamp">
          Named after Butters — a very good girl.
        </p>
      </Section>

      <Tape unit="Tbsp" className="mx-auto mt-12 max-w-5xl px-6" />

      {/* 02 — WHAT'S INSIDE */}
      <Section no="Section 02 / The Kit" title="What's Inside" sub="Picture · Words · Export">
        <div className="mt-2 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Feature title="Picture → Stitches" motif={<ImageMotif />}>
            Drop in a logo. Get clean stitches.
          </Feature>
          <Feature title="Add Words" motif={<TypeMotif />}>
            Type a name in curated fonts.
          </Feature>
          <Feature title="Preview &amp; Export" motif={<NeedleMotif />}>
            Watch it sew, then save to your machine.
          </Feature>
        </div>
      </Section>

      <Tape unit="Tbsp" className="mx-auto mt-12 max-w-5xl px-6" />

      {/* 03 — HOW IT WORKS */}
      <Section no="Section 03 / The Method" title="How It Works" sub="Math, not magic">
        <p className="max-w-2xl font-body text-[16px] leading-relaxed text-char">
          No black-box AI — pure math and logic. Every design gets underlay,
          tie-offs, and safe stitch lengths, so it sews right the first time:
        </p>
        <Tape
          className="mt-7"
          fillPct={1}
          animate
          labels={["Trace", "Path", "Fill", "Underlay", "Satin", "Tie-off", "Preview", "Export"]}
        />
      </Section>

      <Tape unit="Tbsp" className="mx-auto mt-12 max-w-5xl px-6" />

      {/* 04 — FORMATS */}
      <Section no="Section 04 / The Tickets" title="The Formats" sub="Home &amp; commercial machines">
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Stamp variant="solid">PES</Stamp>
          <Stamp>DST</Stamp>
          <Stamp>JEF</Stamp>
          <Stamp variant="red">EXP</Stamp>
          <Stamp variant="red">VP3</Stamp>
          <span className="mx-2 font-body text-[15px] text-char/70">
            — the formats your machine reads.
          </span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Stamp>Net Wt. Free</Stamp>
          <Stamp variant="red">Grade AA</Stamp>
        </div>
      </Section>

      <Tape unit="Tbsp" className="mx-auto mt-12 max-w-5xl px-6" />

      {/* 05 — WHY OPEN SOURCE */}
      <Section no="Section 05 / The Promise" title="Why It's Free" sub="Open source, for everyone">
        <div className="mt-2 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Feature title="Free Forever">
            Pro tools cost hundreds. This is always free.
          </Feature>
          <Feature title="Stays On Your Machine">
            Runs in your browser. Nothing is uploaded.
          </Feature>
          <Feature title="Open &amp; Yours">
            Open-source, improving in the open.
          </Feature>
        </div>
        <div className="mt-9 sm:pl-0">
          <PressButton onClick={onStart} className="text-base">
            Start Stitching
          </PressButton>
        </div>
      </Section>

      <Tape unit="Tbsp" className="mx-auto mt-12 max-w-5xl px-6" />

      {/* FOOTER BAND */}
      <div className="mx-auto max-w-5xl px-6 pb-2">
        <div className="border-y-[3px] border-ink py-5 text-center">
          <div className="font-display text-2xl uppercase tracking-wide text-ink-deep sm:text-4xl">
            Net Wt. Free · 100% Open Source
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}

/** A homepage section: numbered head, a vertical printed rule down its margin
 *  (the consistent per-section fixture), and content. */
function Section({
  no,
  title,
  sub,
  children,
  className = "",
}: {
  no: string;
  title: string;
  sub?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`relative mx-auto max-w-5xl px-6 ${className}`}>
      {/* vertical ruler divider — hidden on narrow screens to keep copy roomy */}
      <div aria-hidden className="absolute bottom-3 left-6 top-3 hidden sm:block">
        <Tape orientation="vertical" className="h-full" />
      </div>
      <div className="sm:pl-12">
        <SectionHead no={no} title={title} sub={sub} />
        {children}
      </div>
    </div>
  );
}

function Feature({
  title,
  motif,
  children,
}: {
  title: string;
  motif?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PressCard className="p-5">
      {motif && <div className="mb-3">{motif}</div>}
      <h3 className="font-label text-lg font-semibold uppercase tracking-[0.08em] text-ink-deep">
        {title}
      </h3>
      <p className="mt-1.5 font-body text-[14px] leading-relaxed text-char/80">
        {children}
      </p>
    </PressCard>
  );
}

// --- single-weight line motifs (Press Blue on cream) -----------------------
const INK = "#173A7A";
function ImageMotif() {
  return (
    <svg width="48" height="48" viewBox="0 0 58 58" fill="none" aria-hidden>
      <rect x="14" y="10" width="30" height="38" rx="2" stroke={INK} strokeWidth="2.5" />
      <circle cx="29" cy="20" r="5" stroke={INK} strokeWidth="2" />
      <path d="M22 40 L26 31 L33 36 L38 28" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function TypeMotif() {
  // A serif "Aa" — clearly "type / add words", in the brand accent face.
  return (
    <svg width="48" height="48" viewBox="0 0 58 58" fill="none" aria-hidden>
      <text
        x="29"
        y="42"
        textAnchor="middle"
        fill={INK}
        fontFamily="'DM Serif Display', Georgia, serif"
        fontSize="40"
      >
        Aa
      </text>
    </svg>
  );
}
function GithubGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}
function NeedleMotif() {
  return (
    <svg width="48" height="48" viewBox="0 0 58 58" fill="none" aria-hidden>
      <path d="M29 6 L29 44" stroke={INK} strokeWidth="2.5" />
      <circle cx="29" cy="48" r="4" stroke={INK} strokeWidth="2.5" />
      <path d="M29 10 L24 16 M29 10 L34 16" stroke={INK} strokeWidth="2" strokeLinecap="round" />
      <path d="M20 24 q9 8 18 0" stroke="#B23A2E" strokeWidth="1.5" strokeDasharray="3 3" />
    </svg>
  );
}
