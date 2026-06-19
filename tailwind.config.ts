import type { Config } from "tailwindcss";

/**
 * Marin design tokens — transcribed verbatim from the design handoff README.
 * Colors map to CSS variables (defined in src/styles/tokens.css) so the
 * palette stays themeable, while utilities resolve to the exact hex values.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand / accent (plum)
        plum: {
          DEFAULT: "var(--plum)",
          deep: "var(--plum-deep)",
          muted: "var(--plum-muted)",
          muted2: "var(--plum-muted-2)",
          soft: "var(--plum-soft)",
          gradlight: "var(--plum-grad-light)",
          border: "var(--plum-border)",
          hairline: "var(--plum-hairline)",
        },
        funnel: {
          1: "var(--funnel-1)",
          2: "var(--funnel-2)",
          3: "var(--funnel-3)",
          4: "var(--funnel-4)",
          5: "var(--funnel-5)",
        },
        // Warm inks
        ink: {
          900: "var(--ink-900)",
          800: "var(--ink-800)",
          700: "var(--ink-700)",
          600: "var(--ink-600)",
          500: "var(--ink-500)",
          450: "var(--ink-450)",
          400: "var(--ink-400)",
          380: "var(--ink-380)",
          300: "var(--ink-300)",
          200: "var(--ink-200)",
        },
        // Greige surfaces
        surface: {
          page: "var(--surface-page)",
          panel: "var(--surface-panel)",
          chip: "var(--surface-chip)",
          rec: "var(--surface-rec)",
          card: "var(--surface-card)",
          sidebar: "var(--surface-sidebar)",
        },
        // Borders / hairlines / tracks
        line: {
          1: "var(--border-1)",
          2: "var(--border-2)",
          3: "var(--border-3)",
          4: "var(--border-4)",
          5: "var(--border-5)",
          6: "var(--border-6)",
          seg: "var(--border-seg)",
        },
        track: {
          1: "var(--track-1)",
          2: "var(--track-2)",
          grid: "var(--track-grid)",
          base: "var(--track-base)",
        },
        chartbar: "var(--chart-bar)",
        fauxhair: "var(--hairline-faux)",
        btnoutline: "var(--btn-outline)",
        // Semantic — positive (green)
        pos: {
          700: "var(--pos-700)",
          500: "var(--pos-500)",
          bg: "var(--pos-bg)",
          soft: "var(--pos-soft)",
        },
        // Semantic — negative (crimson)
        neg: {
          700: "var(--neg-700)",
          bg: "var(--neg-bg)",
        },
        // Status dots
        dot: {
          connected: "var(--dot-connected)",
          disconnected: "var(--dot-disconnected)",
        },
      },
      fontFamily: {
        sans: ["var(--font-hanken)", "system-ui", "sans-serif"],
        serif: ["var(--font-newsreader)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        pill: "6px",
        chip: "8px",
        btn: "10px",
        card: "14px",
        input: "13px",
        modal: "18px",
      },
      spacing: {
        sidebar: "266px",
        chat: "456px",
        topbar: "57px",
      },
      maxWidth: {
        thread: "840px",
        report: "980px",
      },
      boxShadow: {
        composer: "0 2px 10px rgba(43,39,34,0.04)",
        modal: "0 24px 60px rgba(43,39,34,0.25)",
      },
      keyframes: {
        riseIn: {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        fadeUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        dotPulse: {
          "0%,80%,100%": { opacity: "0.25", transform: "translateY(0)" },
          "40%": { opacity: "1", transform: "translateY(-3px)" },
        },
        blink: {
          "0%,50%": { opacity: "1" },
          "51%,100%": { opacity: "0" },
        },
      },
      animation: {
        riseIn: "riseIn 0.5s cubic-bezier(.2,.7,.2,1) both",
        fadeUp: "fadeUp 0.5s both",
        fadeUpFast: "fadeUp 0.2s both",
        dotPulse: "dotPulse 1.2s infinite",
        blink: "blink 1s step-end infinite",
      },
    },
  },
  plugins: [],
};

export default config;
