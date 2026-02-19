export const slack = {
  sidebarBg: "#1a1d21",
  sidebarHover: "#27242c",
  sidebarActive: "#1164a3",
  sidebarText: "#cfc3cf",
  sidebarTextBright: "#ffffff",

  topbarBg: "#1a1d21",

  mainBg: "#1a1d21",
  messageBg: "#222529",
  messageHoverBg: "#27242c",

  textPrimary: "#d1d2d3",
  textSecondary: "#ababad",
  textMuted: "#696969",

  borderColor: "#35373b",
  divider: "#35373b",

  accentBlue: "#1d9bd1",
  accentGreen: "#2bac76",
  accentRed: "#e01e5a",
  accentYellow: "#ecb22e",
  accentPurple: "#6b2fa0",

  onlineGreen: "#2bac76",
  mentionBadge: "#e01e5a",

  inputBg: "#222529",
  inputBorder: "#565856",
  inputFocusBorder: "#1d9bd1",

  channelHashColor: "#ababad",

  hoverActionsBg: "#1a1d21",
} as const;

export type SlackTheme = typeof slack;
