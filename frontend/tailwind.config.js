/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        background: {
          base: "rgb(var(--color-background-base) / <alpha-value>)",
          surface: "rgb(var(--color-background-surface) / <alpha-value>)",
          elevated: "rgb(var(--color-background-elevated) / <alpha-value>)"
        },
        border: "rgb(var(--color-border) / <alpha-value>)",
        text: {
          primary: "rgb(var(--color-text-primary) / <alpha-value>)",
          secondary: "rgb(var(--color-text-secondary) / <alpha-value>)",
          muted: "rgb(var(--color-text-muted) / <alpha-value>)"
        },
        brand: {
          primary: "rgb(var(--color-brand-primary) / <alpha-value>)",
          hover: "rgb(var(--color-brand-primary-hover) / <alpha-value>)"
        },
        success: "rgb(var(--color-success) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        info: "rgb(var(--color-info) / <alpha-value>)"
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"]
      },
      fontSize: {
        xs: ["12px", { lineHeight: "1.5" }],
        sm: ["14px", { lineHeight: "1.5" }],
        base: ["16px", { lineHeight: "1.5" }],
        lg: ["18px", { lineHeight: "1.5" }],
        xl: ["20px", { lineHeight: "1.3" }],
        "2xl": ["24px", { lineHeight: "1.3" }],
        "3xl": ["30px", { lineHeight: "1.3" }],
        "4xl": ["36px", { lineHeight: "1.3" }]
      },
      spacing: {
        1: "4px",
        2: "8px",
        3: "12px",
        4: "16px",
        5: "20px",
        6: "24px",
        8: "32px",
        10: "40px",
        12: "48px",
        16: "64px"
      },
      borderRadius: {
        sm: "4px",
        md: "8px",
        lg: "12px",
        card: "16px",
        pill: "9999px"
      },
      boxShadow: {
        card: "var(--shadow-card)",
        elevated: "var(--shadow-elevated)"
      },
      keyframes: {
        "page-fade": {
          from: { opacity: "0" },
          to: { opacity: "1" }
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" }
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" }
        },
        "modal-in": {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" }
        },
        "drawer-left": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" }
        },
        "drawer-bottom": {
          from: { transform: "translateY(100%)" },
          to: { transform: "translateY(0)" }
        },
        "toast-in": {
          from: { opacity: "0", transform: "translateX(24px)" },
          to: { opacity: "1", transform: "translateX(0)" }
        },
        "warning-bounce": {
          "0%": { opacity: "0", transform: "scale(0.9)" },
          "70%": { opacity: "1", transform: "scale(1.05)" },
          "100%": { opacity: "1", transform: "scale(1)" }
        },
        "soft-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.58" }
        },
        "float-slow": {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" }
        },
        "flip-second": {
          "0%": { transform: "rotateX(0deg)" },
          "50%": { transform: "rotateX(-18deg)" },
          "100%": { transform: "rotateX(0deg)" }
        }
      },
      animation: {
        "page-fade": "page-fade 150ms ease both",
        "fade-in-up": "fade-in-up 250ms ease-out both",
        shimmer: "shimmer 1.5s linear infinite",
        "modal-in": "modal-in 200ms ease both",
        "drawer-left": "drawer-left 250ms ease-out both",
        "drawer-bottom": "drawer-bottom 250ms ease-out both",
        "toast-in": "toast-in 300ms ease-out both",
        "warning-bounce": "warning-bounce 300ms ease both",
        "soft-pulse": "soft-pulse 1.2s ease-in-out infinite",
        "float-slow": "float-slow 5s ease-in-out infinite",
        "flip-second": "flip-second 240ms ease"
      }
    }
  },
  plugins: []
};
