import { useState, useMemo } from "react";
import { Stack, Button } from "@mantine/core";
import { IconPlus, IconHeartHandshake } from "@tabler/icons-react";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { PageShell } from "../../components/shared/PageShell.js";
import { HeartbeatCard } from "../../components/heartbeat/HeartbeatCard.js";
import { HeartbeatDetailModal } from "../../components/heartbeat/HeartbeatDetailModal.js";
import { HeartbeatForm } from "../../components/heartbeat/HeartbeatForm.js";
import { useAppState } from "../../components/layout/app-state-context.js";
import type { HeartbeatEntry } from "../../api/types.js";

export function HeartbeatView() {
  const state = useAppState();
  const heartbeats = state.heartbeats ?? [];
  const configured = useMemo(
    () => heartbeats.filter((h) => h.config),
    [heartbeats],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HeartbeatEntry | null>(null);
  const [selected, setSelected] = useState<HeartbeatEntry | null>(null);

  const openAdd = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (entry: HeartbeatEntry) => {
    setEditing(entry);
    setSelected(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
  };

  return (
    <PageShell
      title="Heartbeat"
      headerRight={
        <Button
          size="xs"
          variant="filled"
          leftSection={<IconPlus size={14} />}
          onClick={openAdd}
        >
          Add Heartbeat
        </Button>
      }
    >
      {configured.length === 0 ? (
        <EmptyState
          icon={<IconHeartHandshake size={32} />}
          message="No heartbeat schedules configured"
        />
      ) : (
        <Stack gap={8}>
          {configured.map((entry) => (
            <HeartbeatCard
              key={entry.agentName}
              entry={entry}
              onClick={setSelected}
            />
          ))}
        </Stack>
      )}

      <HeartbeatDetailModal
        entry={selected}
        opened={selected !== null}
        onClose={() => setSelected(null)}
        onEdit={openEdit}
      />

      <HeartbeatForm
        opened={formOpen}
        onClose={closeForm}
        agentNames={heartbeats.map((h) => h.agentName)}
        editEntry={editing}
      />
    </PageShell>
  );
}
