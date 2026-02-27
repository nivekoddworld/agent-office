import { generateColors } from "@mantine/colors-generator";
import type { MantineColorsTuple } from "@mantine/core";

// Brand primary — Sage Green (hand-tuned for button contrast)
export const sage: MantineColorsTuple = [
  "#f0f5f1", // 0 — lightest (light variant bg)
  "#d5e4d8", // 1 — light sage (dark mode light-variant text)
  "#b5cfba", // 2 — outline color in dark mode
  "#93b89a", // 3 — muted accent
  "#74a37c", // 4 — medium (light bg overlay source)
  "#5f9268", // 5 — hover state
  "#4f8058", // 6 — filled button / primary shade
  "#416b49", // 7 — filled hover (dark mode)
  "#34573b", // 8 — dark accent
  "#27432e", // 9 — darkest
];

// Brand accent — Warm Coral
export const coral = generateColors("#e8764b");

// Warm-tinted dark scale (replaces Mantine's cold blue-gray default)
export const warmDark: MantineColorsTuple = [
  "#e7e5e4", // 0 — text primary (dark mode)
  "#d6d3d1", // 1 — sidebar text
  "#a8a29e", // 2 — text secondary
  "#78716c", // 3 — text muted
  "#57534e", // 4 — input border
  "#44403c", // 5 — border
  "#292524", // 6 — surface bg
  "#1c1917", // 7 — body bg / sidebar bg
  "#150f0d", // 8 — deeper bg
  "#0c0a09", // 9 — darkest
];
