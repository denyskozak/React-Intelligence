import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#080b12",
        panel: "#10151f",
        muted: "#7c8798",
        line: "#202a3a",
        accent: "#38bdf8",
        good: "#22c55e",
        warn: "#f59e0b",
        bad: "#ef4444"
      }
    }
  },
  plugins: []
} satisfies Config;
