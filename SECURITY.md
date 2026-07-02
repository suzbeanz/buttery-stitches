# Security Policy

## The security model

Buttery Stitches is a **fully client-side** app: there is no backend, no
account system, and nothing you load or create ever leaves your machine. The
attack surface is correspondingly small, and the app is built to keep it that
way:

- Untrusted embroidery files (`.pes`, `.dst`, `.jef`, `.exp`, `.vp3`) are
  parsed **inside a WebAssembly sandbox** (pyembroidery under Pyodide), never
  by hand-rolled parsers with access to the DOM.
- Imports are size- and stitch-count-capped so a crafted file can't exhaust
  the tab's memory.
- A strict Content-Security-Policy (see `index.html`) allows only the app's
  own origin plus the Pyodide CDN; the e2e suite fails if anything on the page
  contacts an unexpected third-party origin.
- There is no `eval`, no `dangerouslySetInnerHTML`, and no path that renders
  uploaded SVG/HTML into the DOM (images are rasterized to canvas pixels).

## Reporting a vulnerability

If you find a security issue — e.g. a way for a crafted file to escape the
parsing sandbox, break the CSP, or execute script — please report it
privately rather than opening a public issue:

1. Use GitHub's **"Report a vulnerability"** (Security tab → Advisories →
   Report) on this repository, or
2. Contact the maintainer via the contact listed on their GitHub profile.

Please include a proof-of-concept file or steps to reproduce. You should hear
back within a week. Since the app is client-side, most issues can be fixed and
deployed quickly; credit is gladly given unless you prefer otherwise.

## Supported versions

Only the latest deployed version (the `main` branch, published at the live
site) is supported. There are no long-term-support branches.
