/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // 🧈 Butter palette — warm, creamy yellows.
        butter: {
          50: "#FFFDF4",
          100: "#FCF4D0",
          200: "#F9E9A6", // "butter yellow"
          300: "#F4DC79",
          400: "#EBCB4E",
          500: "#D9B23A",
          600: "#B8902A",
        },
        // Classic navy to pair with butter (think dairy-carton lettering).
        navy: {
          DEFAULT: "#16234A",
          light: "#27386E",
          dark: "#0E1733",
        },
        // The "salted" accent — used sparingly, like the red stamp on a wrapper.
        salted: "#C0392B",
        cream: "#FFFDF3",
      },
      fontFamily: {
        // The "classic butter" wordmark — an elegant retro serif, degrading
        // gracefully to widely-installed serifs so the app needs no network.
        butter: ['"Playfair Display"', "Georgia", '"Times New Roman"', "serif"],
      },
      boxShadow: {
        // Warm, soft shadows so panels and dialogs feel pillowy, not harsh.
        butter: "0 8px 24px -12px rgba(22, 35, 74, 0.25)",
        card: "0 1px 2px rgba(22, 35, 74, 0.06), 0 6px 20px -10px rgba(22, 35, 74, 0.18)",
      },
    },
  },
  plugins: [],
};
