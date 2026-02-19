import { createTheme } from "@mantine/core";

export const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "sm",
  fontFamily:
    "Lato, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  colors: {
    dark: [
      "#d1d2d3",
      "#ababad",
      "#8e8e8e",
      "#696969",
      "#565856",
      "#35373b",
      "#222529",
      "#1a1d21",
      "#111315",
      "#0b0d0e",
    ],
  },
  other: {
    slackAccent: "#1d9bd1",
    slackGreen: "#2bac76",
    slackRed: "#e01e5a",
  },
});
