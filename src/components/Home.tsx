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
 * ink on churned-butter stock, the tablespoon tape running full-bleed between
 * every section as the structural grid, grade stamps, and press-block fixtures.
 */
const TBSP = ["1 Tbsp", "2 Tbsp", "3 Tbsp", "4 Tbsp", "5 Tbsp", "6 Tbsp", "7 Tbsp", "8 Tbsp"];

export default function Home({ onStart }: { onStart: () => void }) {
  return (
    <div className="h-full overflow-y-auto">
      {/* HERO — the label */}
      <Col className="pt-10 sm:pt-16">
        <PressCard className="px-6 py-8 sm:px-10 sm:py-10">
          <div className="flex items-center justify-between border-b-[1.5px] border-foil pb-3 font-label text-[12px] font-semibold uppercase tracking-[0.22em] text-ink">
            <span>Open Source</span>
            <span>Net Wt. Free · 100% Free</span>
          </div>

          <div className="mt-7 flex flex-wrap items-center justify-center gap-x-7 gap-y-4">
            <GradeStamp size={74} className="hidden sm:block" />
            <div className="text-center leading-none">
              <div className="font-accent text-2xl italic text-stamp sm:text-3xl">
                Sweet &amp; Unsalted
              </div>
              <div className="font-display text-6xl uppercase leading-[0.82] tracking-wide text-ink sm:text-8xl">
                Buttery
                <br />
                Stitches
              </div>
              <div className="mt-4 font-label text-[12px] font-medium uppercase tracking-[0.4em] text-ink-deep sm:text-sm">
                Embroidery Digitizing — Churned to Order
              </div>
            </div>
            <GradeStamp size={74} rotate={7} top="Made" big="100" bottom="% Open" className="hidden sm:block" />
          </div>

          <div className="mt-7 text-center font-mono text-[12px] uppercase tracking-[0.14em] text-char/80">
            Net Wt. Free · Pictures, Words &amp; Shapes → Machine-Ready Stitches
          </div>
        </PressCard>

        <div className="mt-7 text-center">
          <PressButton onClick={onStart} className="text-base">
            Start Stitching
          </PressButton>
          <p className="mt-3 font-mono text-[11px] uppercase tracking-[0.14em] text-char/60">
            Free · No sign-up · Stays on your machine
          </p>
        </div>
      </Col>

      <Tape labels={TBSP} className="mt-12" />

      {/* 01 — THE SPREAD */}
      <Col>
        <SectionHead no="Section 01 / Half Cup" title="The Spread" sub="What it does" />
        <p className="max-w-2xl font-body text-[17px] leading-relaxed text-char">
          Buttery Stitches turns pictures, words, and shapes into machine-ready
          embroidery files — churned right in your browser, free and open-source.
          It borrows the honest confidence of a dairy-case butter label:{" "}
          <b className="text-ink">one good product, plainly made.</b> No gradients,
          no startup gloss — just clean stitches, measured and exact.
        </p>
      </Col>

      <Tape labels={TBSP} className="mt-12" />

      {/* 02 — WHAT'S INSIDE */}
      <Col>
        <SectionHead no="Section 02 / The Kit" title="What's Inside" sub="Picture · Words · Export" />
        <div className="mt-2 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Feature title="Picture → Stitches" motif={<ImageMotif />}>
            Drop in a logo or line art and get clean, machine-ready stitches.
          </Feature>
          <Feature title="Add Words" motif={<StickMotif />}>
            Stitch a name or message in curated fonts — crisp satin or solid fill.
          </Feature>
          <Feature title="Preview &amp; Export" motif={<NeedleMotif />}>
            Watch it sew inside the hoop, then save to your machine's format.
          </Feature>
        </div>
      </Col>

      <Tape labels={TBSP} className="mt-12" />

      {/* 03 — HOW IT WORKS */}
      <Col>
        <SectionHead no="Section 03 / The Method" title="How It Works" sub="Trace → Export" />
        <p className="max-w-2xl font-body text-[16px] leading-relaxed text-char">
          Every design is portioned the same careful way — underlay, tie-offs, and
          safe stitch lengths so it sews reliably. The tape fills as it's digitized:
        </p>
        <Tape
          className="mt-7"
          fillPct={1}
          labels={["Trace", "Path", "Fill", "Underlay", "Satin", "Tie-off", "Preview", "Export"]}
        />
      </Col>

      <Tape labels={TBSP} className="mt-12" />

      {/* 04 — FORMATS */}
      <Col>
        <SectionHead no="Section 04 / The Tickets" title="The Formats" sub="Home &amp; commercial machines" />
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
      </Col>

      <Tape labels={TBSP} className="mt-12" />

      {/* 05 — WHY OPEN SOURCE */}
      <Col>
        <SectionHead no="Section 05 / The Promise" title="Why It's Free" sub="Open source, for everyone" />
        <div className="mt-2 grid grid-cols-1 gap-5 sm:grid-cols-3">
          <Feature title="Free Forever">
            Pro digitizing software costs hundreds. This costs nothing, always.
          </Feature>
          <Feature title="Stays On Your Machine">
            Everything runs in your browser. Nothing is ever uploaded.
          </Feature>
          <Feature title="Open &amp; Yours">
            Open-source and improving in the open — proof that free can be the best.
          </Feature>
        </div>
        <div className="mt-9 text-center">
          <PressButton onClick={onStart} className="text-base">
            Start Stitching
          </PressButton>
        </div>
      </Col>

      <Tape labels={TBSP} className="mt-12" />

      {/* FOOTER BAND */}
      <Col className="pb-2">
        <div className="border-y-[3px] border-ink py-5 text-center">
          <div className="font-display text-2xl uppercase tracking-wide text-ink-deep sm:text-4xl">
            Net Wt. Free · 100% Open Source
          </div>
        </div>
      </Col>
      <Footer />
    </div>
  );
}

/** Centered measured column; the tape rules run full-bleed outside it. */
function Col({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto max-w-5xl px-6 ${className}`}>{children}</div>;
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
function StickMotif() {
  return (
    <svg width="48" height="48" viewBox="0 0 58 58" fill="none" aria-hidden>
      <rect x="8" y="20" width="42" height="18" rx="2" stroke={INK} strokeWidth="2.5" />
      <path d="M8 24 L14 20 M8 34 L14 38 M50 24 L44 20 M50 34 L44 38" stroke={INK} strokeWidth="1.5" />
      <line x1="20" y1="20" x2="20" y2="38" stroke={INK} strokeWidth="1" />
      <line x1="38" y1="20" x2="38" y2="38" stroke={INK} strokeWidth="1" />
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
