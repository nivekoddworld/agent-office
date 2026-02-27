import { createTheme, virtualColor } from "@mantine/core";
import { sage, coral, warmDark } from "./colors.js";

export const theme = createTheme({
  primaryColor: "sage",
  primaryShade: { light: 6, dark: 6 },
  autoContrast: true,
  defaultRadius: "lg",
  fontFamily:
    'Lato, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  colors: {
    dark: warmDark,
    sage,
    coral,
    surface: virtualColor({
      name: "surface",
      dark: "dark",
      light: "gray",
    }),
  },
  components: {
    Paper: {
      defaultProps: { radius: "lg" },
    },
    Modal: {
      defaultProps: { radius: "lg" },
    },
    Badge: {
      defaultProps: { radius: "lg" },
    },
    Button: {
      defaultProps: { radius: "lg" },
    },
    ActionIcon: {
      defaultProps: { radius: "lg" },
    },
    TextInput: {
      defaultProps: { radius: "md" },
    },
    Select: {
      defaultProps: { radius: "md" },
    },
    MultiSelect: {
      defaultProps: { radius: "md" },
    },
    Drawer: {
      defaultProps: { radius: "lg" },
    },
    Accordion: {
      defaultProps: { radius: "lg" },
    },
  },
});
