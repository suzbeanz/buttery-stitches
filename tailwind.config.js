/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      screens: {
        // Small-phone floor: ≥360px the top bar holds one row; below it the
        // bar wraps instead of scrolling (a scroll container there breaks
        // fixed-position dialogs on iOS Safari).
        xs: "360px",
      },
      colors: {
        // Butter-wrapper inks (Edition 01). Flat colors, printed on cream stock.
        ink: { DEFAULT: "#173A7A", deep: "#102A57" }, // Press Blue / Midnight Press
        stamp: "#B23A2E", // Stamp Red — marks, measures, one CTA
        butter: {
          DEFAULT: "#F1DE8B", // Churned Butter — primary background fill
          deep: "#E7CC63", // Deep Churn — panels / shadow edge
          // Numeric scale kept for back-compat with existing classes, remapped
          // onto the new wrapper palette (50 lightest → 400 foil).
          50: "#FBF6DD",
          100: "#F6EFCB",
          200: "#F1DE8B",
          300: "#E7CC63",
          400: "#C9A227",
          500: "#B8902A",
          600: "#9A7A22",
        },
        foil: "#C9A227", // Foil Gold — hairlines, fine accents
        cream: "#F6EFCB", // Cream Wrapper — paper / card stock
        char: "#25241C", // Char Black — body copy
        // Back-compat aliases so existing classes keep resolving during the
        // migration (navy → ink, paper/panel → wrapper/cream, salted → stamp).
        navy: { DEFAULT: "#173A7A", light: "#27406F", dark: "#102A57" },
        paper: "#F1DE8B",
        panel: "#F6EFCB",
        sepia: "#25241C",
        salted: "#B23A2E",
      },
      fontFamily: {
        display: ['"Anton"', '"Oswald"', "Impact", "sans-serif"], // wordmark / titles
        label: ['"Oswald"', "system-ui", "sans-serif"], // labels / buttons / eyebrows
        body: ['"Libre Franklin"', "system-ui", "sans-serif"], // body copy
        accent: ['"DM Serif Display"', "Georgia", "serif"], // italic taglines
        mono: ['"Space Mono"', "ui-monospace", "monospace"], // measures / metadata
        // Back-compat: the old wordmark class used `font-butter`.
        butter: ['"Anton"', '"Oswald"', "Impact", "sans-serif"],
      },
      boxShadow: {
        // Hard, offset "press" shadow — stamped onto the page, never a soft glow.
        press: "0 3px 0 #102A57",
        "press-sm": "0 2px 0 #102A57",
        "press-stamp": "0 3px 0 #8C2C22",
        card: "0 2px 0 #173A7A",
      },
    },
  },
  plugins: [],
};
