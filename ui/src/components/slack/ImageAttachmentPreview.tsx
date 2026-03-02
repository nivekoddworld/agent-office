import { Box, Group, ActionIcon } from "@mantine/core";
import { IconX } from "@tabler/icons-react";

interface ImagePreviewItem {
  src: string;
  alt: string;
}

interface ImageAttachmentPreviewProps {
  images: ImagePreviewItem[];
  onRemove?: (index: number) => void;
  size?: number;
}

export function ImageAttachmentPreview({
  images,
  onRemove,
  size = 80,
}: ImageAttachmentPreviewProps) {
  if (images.length === 0) return null;

  return (
    <Group gap={8} px="xs" py={4}>
      {images.map((img, i) => (
        <Box
          key={i}
          style={{
            position: "relative",
            width: size,
            height: size,
            borderRadius: 8,
            overflow: "hidden",
            border: "1px solid var(--ao-border)",
            flexShrink: 0,
          }}
        >
          <img
            src={img.src}
            alt={img.alt}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
          {onRemove && (
            <ActionIcon
              size={18}
              variant="filled"
              color="dark"
              onClick={() => onRemove(i)}
              style={{
                position: "absolute",
                top: 2,
                right: 2,
                opacity: 0.8,
              }}
            >
              <IconX size={12} />
            </ActionIcon>
          )}
        </Box>
      ))}
    </Group>
  );
}
