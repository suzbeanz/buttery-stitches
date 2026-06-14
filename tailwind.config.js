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
        cream: "#FFFDF3",
      },
      fontFamily: {
        // The "classic butter" wordmark — an elegant retro serif, degrading
        // gracefully to widely-installed serifs so the app needs no network.
        butter: ['"Playfair Display"', "Georgia", '"Times New Roman"', "serif"],
      },
    },
  },
  plugins: [],
};
