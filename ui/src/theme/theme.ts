import { createTheme, virtualColor } from "@mantine/core";
import { cyber, neonPurple, cyberDark } from "./colors.js";

export const theme = createTheme({
  primaryColor: "cyber",
  autoContrast: true,
  defaultRadius: "md",
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  colors: {
    dark: cyberDark,
    cyber,
    neonPurple,
    surface: virtualColor({
      name: "surface",
      dark: "dark",
      light: "dark",
    }),
  },
  components: {
    Paper: {
      defaultProps: { radius: "md" },
    },
    Modal: {
      defaultProps: { radius: "md" },
    },
    Badge: {
      defaultProps: { radius: "sm" },
    },
    Button: {
      defaultProps: { radius: "md" },
    },
    ActionIcon: {
      defaultProps: { radius: "md" },
    },
    TextInput: {
      defaultProps: { radius: "sm" },
    },
    Select: {
      defaultProps: { radius: "sm" },
    },
    MultiSelect: {
      defaultProps: { radius: "sm" },
    },
    Drawer: {
      defaultProps: { radius: "md" },
    },
    Accordion: {
      defaultProps: { radius: "md" },
    },
  },
});
