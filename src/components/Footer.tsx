/**
 * Site footer — a warm signature with links to the maker. Used on the homepage
 * (the editor itself is full-screen, so it carries no footer). The brand marks
 * are inline SVGs since the icon set drops third-party logos.
 */
export default function Footer() {
  return (
    <div className="px-6 py-6 text-center text-navy">
      <p className="text-sm font-semibold">
        Made With <span aria-label="love">❤️</span> by Suz
      </p>
      <div className="mt-3 flex items-center justify-center gap-3">
        <a
          href="https://www.linkedin.com/in/suzie-schmitt/"
          target="_blank"
          rel="noreferrer"
          aria-label="Suz on LinkedIn"
          className="grid h-10 w-10 place-items-center rounded-full border-2 border-navy text-navy transition-colors hover:bg-navy hover:text-butter-200"
        >
          <LinkedInMark />
        </a>
        <a
          href="https://github.com/suzbeanz/"
          target="_blank"
          rel="noreferrer"
          aria-label="Suz on GitHub"
          className="grid h-10 w-10 place-items-center rounded-full border-2 border-navy text-navy transition-colors hover:bg-navy hover:text-butter-200"
        >
          <GitHubMark />
        </a>
      </div>
      <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-navy/45">
        Distributed by Buttery Stitches · Open Source
      </p>
    </div>
  );
}

function LinkedInMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58v-2.03c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.74.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.17 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.65.25 2.87.12 3.17.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22v3.29c0 .32.22.7.83.58A12.01 12.01 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}
