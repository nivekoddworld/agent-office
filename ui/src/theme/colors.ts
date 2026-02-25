import { generateColors } from "@mantine/colors-generator";
import type { MantineColorsTuple } from "@mantine/core";

// Brand primary — Electric Cyan (cyberpunk neon)
export const cyber = generateColors("#00d4ff");

// Brand accent — Neon Purple
export const neonPurple = generateColors("#a855f7");

// Cyberpunk dark scale (true blacks)
export const cyberDark: MantineColorsTuple = [
  "#c9d1d9", // 0 — text primary
  "#8b949e", // 1 — sidebar text
  "#6e7681", // 2 — text secondary
  "#3b3f46", // 3 — text muted
  "#222528", // 4 — input border
  "#161819", // 5 — border
  "#0c0d0e", // 6 — surface bg
  "#050506", // 7 — body bg
  "#020202", // 8 — deeper bg (sidebar)
  "#000000", // 9 — darkest
];
