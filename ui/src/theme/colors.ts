import { generateColors } from "@mantine/colors-generator";
import type { MantineColorsTuple } from "@mantine/core";

// Brand primary — Violet (facehash avatar connection)
export const violet = generateColors("#7048e8");

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
