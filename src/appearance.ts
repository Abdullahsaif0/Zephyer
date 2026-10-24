import { materialCSS } from "./material";
export const themes = {
  graphite: {
    name: "Graphite",
    description: "Charcoal · mint",
    scheme: "dark",
    bg: "#131719",
    surface: "#202629",
    glass: "#202629c7",
    text: "#f1f5f4",
    muted: "#aebcb9",
    line: "#52615e",
    accent: "#bbf2d6",
    onAccent: "#10291f",
    hover: "#33413c",
    danger: "#ffb5a2",
  },
  porcelain: {
    name: "Porcelain",
    description: "Cool white · blue",
    scheme: "light",
    bg: "#f5f7fc",
    surface: "#ffffff",
    glass: "#ffffffc9",
    text: "#17263e",
    muted: "#54677d",
    line: "#b4c2d5",
    accent: "#175bce",
    onAccent: "#ffffff",
    hover: "#e4edfd",
    danger: "#a72d20",
  },
  midnight: {
    name: "Midnight",
    description: "Deep navy · ice",
    scheme: "dark",
    bg: "#10192b",
    surface: "#1a2942",
    glass: "#1a2942c7",
    text: "#edf5ff",
    muted: "#afc3dc",
    line: "#506d92",
    accent: "#a6d9ff",
    onAccent: "#102941",
    hover: "#2b4262",
    danger: "#ffc0a8",
  },
  forest: {
    name: "Forest",
    description: "Evergreen · sage",
    scheme: "dark",
    bg: "#101f1b",
    surface: "#1c3029",
    glass: "#1c3029c7",
    text: "#edf5ea",
    muted: "#b1c4b4",
    line: "#526d5d",
    accent: "#c5dfad",
    onAccent: "#203019",
    hover: "#344b3c",
    danger: "#ffb59d",
  },
  dusk: {
    name: "Dusk",
    description: "Plum · lavender",
    scheme: "dark",
    bg: "#211b2a",
    surface: "#32283f",
    glass: "#32283fc7",
    text: "#f6effc",
    muted: "#c5b6d3",
    line: "#78638b",
    accent: "#dfc1ff",
    onAccent: "#30203f",
    hover: "#4c3d5b",
    danger: "#ffc0b5",
  },
  sand: {
    name: "Sand",
    description: "Ivory · terracotta",
    scheme: "light",
    bg: "#f5efe5",
    surface: "#fffaf2",
    glass: "#fffaf2c9",
    text: "#34271e",
    muted: "#77604d",
    line: "#c3ac91",
    accent: "#963f25",
    onAccent: "#fff8f2",
    hover: "#ecdfcd",
    danger: "#a22c24",
  },
} as const;
export type ThemeId = keyof typeof themes;
export const themeIds = Object.keys(themes) as ThemeId[];
export const validTheme = (v: unknown): v is ThemeId =>
  typeof v === "string" && Object.hasOwn(themes, v);
export function applyTheme(element: HTMLElement, id: ThemeId) {
  const theme = themes[validTheme(id) ? id : "graphite"];
  element.dataset.theme = validTheme(id) ? id : "graphite";
  for (const key of [
    "bg",
    "surface",
    "glass",
    "text",
    "muted",
    "line",
    "accent",
    "onAccent",
    "hover",
    "danger",
  ] as const)
    element.style.setProperty(`--z-${key}`, theme[key]);
  element.style.setProperty("color-scheme", theme.scheme, "important");
}
export const tokensCSS =
  `:root,:host{--z-bg:#131719;--z-surface:#202629;--z-glass:#202629c7;--z-text:#f1f5f4;--z-muted:#aebcb9;--z-line:#52615e;--z-accent:#bbf2d6;--z-onAccent:#10291f;--z-hover:#33413c;--z-danger:#ffb5a2;--z-radius:18px;--z-duration:200ms;--z-shadow:0 12px 40px #00000024,0 2px 6px #00000015} @media(prefers-reduced-motion:reduce){:root,:host{--z-duration:0ms}*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}` +
  materialCSS;
