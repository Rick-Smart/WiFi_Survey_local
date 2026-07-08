// ── Design tokens & themes ───────────────────────────────────────────────
// Every visual value in the app comes from a token here. Components never
// hardcode a color/space/radius — they read `var(--token)`. Adding a new
// theme is just adding another entry with the same keys, and every component
// re-themes automatically.
//
// `structural` tokens are theme-independent (spacing, radius, typography,
// fluid sizes). `themes` provide the palette per named theme.

export const structural = {
  // Spacing scale
  "--space-0": "0px",
  "--space-1": "4px",
  "--space-2": "8px",
  "--space-3": "12px",
  "--space-4": "16px",
  "--space-5": "20px",
  "--space-6": "24px",
  "--space-8": "32px",

  // Radius
  "--radius-sm": "6px",
  "--radius": "10px",
  "--radius-lg": "14px",

  // Typography families
  "--font-sans": "'Segoe UI', system-ui, sans-serif",
  "--font-mono": "'Cascadia Code', 'Consolas', 'Courier New', monospace",

  // Fluid type scale — sizes flex with the container/viewport.
  "--fs-2xs": "clamp(9px, 0.55rem + 0.1vw, 11px)",
  "--fs-xs": "clamp(10px, 0.6rem + 0.15vw, 12px)",
  "--fs-sm": "clamp(12px, 0.7rem + 0.2vw, 13px)",
  "--fs-md": "clamp(13px, 0.8rem + 0.2vw, 15px)",
  "--fs-lg": "clamp(15px, 0.9rem + 0.4vw, 18px)",
  "--fs-xl": "clamp(18px, 1rem + 0.8vw, 22px)",

  // Motion
  "--dur-fast": "0.15s",
  "--dur": "0.25s",
};

// Base (dark) palette — the current "engineer" look, tokenized.
const engineerDark = {
  id: "engineer-dark",
  label: "Engineer · Dark",
  scheme: "dark",
  vars: {
    "--bg": "#0b0d1a",
    "--surface": "#13162b",
    "--surface-2": "#1a1e38",
    "--border": "#252a4a",
    "--accent": "#00d4ff",
    "--accent-2": "#7c6aff",
    "--text": "#dde2f0",
    "--text-2": "#7b8db0",

    // Status / quality semantic colors
    "--green": "#00e676",
    "--yellow": "#ffd740",
    "--orange": "#ff9100",
    "--red": "#ff5252",
    "--gray": "#546e8a",

    "--quality-excellent": "#00e676",
    "--quality-good": "#00e676",
    "--quality-fair": "#ffd740",
    "--quality-poor": "#ff9100",
    "--quality-critical": "#ff5252",
    "--quality-neutral": "#546e8a",

    "--status-ok": "#00e676",
    "--status-warning": "#ffd740",
    "--status-error": "#ff5252",
    "--status-running": "#00d4ff",

    // Surfaces derived for subtle fills
    "--row-alt": "rgba(255,255,255,0.02)",
    "--row-hover": "rgba(255,255,255,0.04)",
    "--hairline": "rgba(255,255,255,0.05)",

    // Shadows/glow
    "--glow-accent": "0 0 14px rgba(0,212,255,0.35)",
  },
};

// A light variant to prove theme-awareness scales (same keys, new values).
const engineerLight = {
  id: "engineer-light",
  label: "Engineer · Light",
  scheme: "light",
  vars: {
    "--bg": "#eef1f8",
    "--surface": "#ffffff",
    "--surface-2": "#f3f5fb",
    "--border": "#d6dcec",
    "--accent": "#0077b6",
    "--accent-2": "#5a4bd6",
    "--text": "#1a2338",
    "--text-2": "#5a6b8c",

    "--green": "#009e52",
    "--yellow": "#c99700",
    "--orange": "#d97500",
    "--red": "#d63a3a",
    "--gray": "#7688a3",

    "--quality-excellent": "#009e52",
    "--quality-good": "#009e52",
    "--quality-fair": "#c99700",
    "--quality-poor": "#d97500",
    "--quality-critical": "#d63a3a",
    "--quality-neutral": "#7688a3",

    "--status-ok": "#009e52",
    "--status-warning": "#c99700",
    "--status-error": "#d63a3a",
    "--status-running": "#0077b6",

    "--row-alt": "rgba(0,0,0,0.02)",
    "--row-hover": "rgba(0,0,0,0.04)",
    "--hairline": "rgba(0,0,0,0.06)",

    "--glow-accent": "0 0 14px rgba(0,119,182,0.25)",
  },
};

export const themes = {
  "engineer-dark": engineerDark,
  "engineer-light": engineerLight,
};

export const defaultThemeId = "engineer-dark";

// Quality/status level → token name helpers (shared by many components).
export function qualityVar(level) {
  const map = {
    excellent: "--quality-excellent",
    good: "--quality-good",
    fair: "--quality-fair",
    poor: "--quality-poor",
    critical: "--quality-critical",
  };
  return `var(${map[level] || "--quality-neutral"})`;
}

export function statusVar(status) {
  const map = {
    ok: "--status-ok",
    warning: "--status-warning",
    error: "--status-error",
    running: "--status-running",
  };
  return `var(${map[status] || "--quality-neutral"})`;
}
