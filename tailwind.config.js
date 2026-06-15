/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 🧈 Butter palette — warm, creamy yellows.
        butter: {
          50: "#FFFDF4",
          100: "#F8F1CF", // "churned cream" — panels & inset stock
          200: "#F3E8BC", // "wrapper cream" — the paper
          300: "#EFDFA6",
          400: "#E7CF7A",
          500: "#D9B23A",
          600: "#B8902A",
        },
        // Press navy — the primary ink (wordmark, rules, type).
        navy: {
          DEFAULT: "#20305F",
          light: "#2E4173",
          dark: "#16223F",
        },
        // The "salted"/stamp red accent — used sparingly.
        salted: "#A5402C",
        // Cream surfaces and warm near-black body copy.
        cream: "#FFFDF3",
        paper: "#F3E8BC", // wrapper cream — primary background
        panel: "#F8F1CF", // churned cream — panels & inset stock
        sepia: "#2C2A20", // warm near-black body copy
      },
      fontFamily: {
        // The "classic butter" wordmark + headlines — Playfair Display.
        butter: ['"Playfair Display"', "Georgia", '"Times New Roman"', "serif"],
        // Body / UI copy — a warm book serif (the butter-wrapper voice).
        body: ['"Old Standard TT"', "Georgia", '"Times New Roman"', "serif"],
      },
      boxShadow: {
        // Soft, flat shadows — no glassy sheen.
        butter: "0 8px 24px -12px rgba(32, 48, 95, 0.25)",
        card: "0 1px 2px rgba(32, 48, 95, 0.06), 0 6px 20px -10px rgba(32, 48, 95, 0.18)",
      },
    },
  },
  plugins: [],
};
