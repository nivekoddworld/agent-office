import { Modal, Text, Group, Button } from "@mantine/core";

interface ConfirmDialogProps {
  opened: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmColor?: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ConfirmDialog({
  opened,
  title,
  message,
  confirmLabel = "Confirm",
  confirmColor = "red",
  onConfirm,
  onCancel,
  loading,
}: ConfirmDialogProps) {
  return (
    <Modal opened={opened} onClose={onCancel} title={title} size="sm" centered>
      <Text size="sm" mb="lg">
        {message}
      </Text>
      <Group justify="flex-end" gap="xs">
        <Button variant="default" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          color={confirmColor}
          size="sm"
          onClick={onConfirm}
          loading={loading}
        >
          {confirmLabel}
        </Button>
      </Group>
    </Modal>
  );
}
