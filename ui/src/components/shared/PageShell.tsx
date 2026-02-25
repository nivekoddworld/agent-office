import { Box, Group, Text } from "@mantine/core";

interface PageShellProps {
  title: string;
  titleExtra?: React.ReactNode;
  headerRight?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  noPadding?: boolean;
  fullHeight?: boolean;
}

export function PageShell({
  title,
  titleExtra,
  headerRight,
  toolbar,
  children,
  noPadding = false,
  fullHeight = false,
}: PageShellProps) {
  return (
    <Box className="ao-page-shell">
      <Group
        className="ao-page-shell-header"
        px="md"
        py="xs"
        justify="space-between"
        style={{ minHeight: 42 }}
      >
        <Group gap={8}>
          <Text size="sm" fw={700} style={{ color: "var(--ao-text-bright)" }}>
            {title}
          </Text>
          {titleExtra}
        </Group>
        {headerRight}
      </Group>

      {toolbar && (
        <Box className="ao-page-shell-toolbar" px="md" py="xs">
          {toolbar}
        </Box>
      )}

      <Box
        className="ao-page-shell-content"
        px={noPadding ? 0 : "md"}
        py={noPadding ? 0 : "md"}
        style={
          fullHeight
            ? { display: "flex", flex: 1, minHeight: 0 }
            : undefined
        }
      >
        {children}
      </Box>
    </Box>
  );
}
