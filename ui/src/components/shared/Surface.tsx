import { Box, type MantineSpacing } from "@mantine/core";

interface SurfaceProps {
  children: React.ReactNode;
  variant?: "default" | "elevated" | "inset";
  accentColor?: string;
  glow?: boolean;
  p?: MantineSpacing;
  style?: React.CSSProperties;
}

const VARIANT_STYLES: Record<string, React.CSSProperties> = {
  default: {
    backgroundColor: "var(--ao-bg-surface)",
    border: "1px solid var(--ao-border)",
  },
  elevated: {
    backgroundColor: "var(--ao-bg-elevated)",
    border: "1px solid var(--ao-border)",
    boxShadow: "0 4px 24px rgba(0, 0, 0, 0.3)",
  },
  inset: {
    backgroundColor: "var(--ao-bg-code)",
    border: "1px solid var(--ao-border)",
  },
};

export function Surface({
  children,
  variant = "default",
  accentColor,
  glow = false,
  p = "sm",
  style,
}: SurfaceProps) {
  return (
    <Box
      p={p}
      className={`ao-surface${glow ? " ao-surface--glow" : ""}`}
      style={{
        borderRadius: 10,
        ...VARIANT_STYLES[variant],
        ...(accentColor ? { borderLeft: `3px solid ${accentColor}` } : {}),
        ...style,
      }}
    >
      {children}
    </Box>
  );
}
