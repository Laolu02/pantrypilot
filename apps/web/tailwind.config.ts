import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "rgb(var(--paper) / <alpha-value>)",
        sunk: "rgb(var(--sunk) / <alpha-value>)",
        card: "rgb(var(--card) / <alpha-value>)",
        ink: "rgb(var(--ink) / <alpha-value>)",
        ink2: "rgb(var(--ink2) / <alpha-value>)",
        mute: "rgb(var(--mute) / <alpha-value>)",
        line: "rgb(var(--line) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "ui-sans-serif", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: { lift: "0 1px 0 rgb(var(--line) / .9), 0 18px 40px -28px rgb(var(--ink) / .35)" },
      keyframes: {
        pulseRing: { "0%": { transform: "scale(.6)", opacity: ".7" }, "100%": { transform: "scale(2.2)", opacity: "0" } },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: { pulseRing: "pulseRing 2.2s cubic-bezier(.2,.6,.3,1) infinite", shimmer: "shimmer 1.6s infinite" },
    },
  },
  plugins: [],
} satisfies Config;
