import { useState, useMemo } from "react";
import { Stack, Button } from "@mantine/core";
import { IconPlus, IconCalendarTime } from "@tabler/icons-react";
import { EmptyState } from "../../components/shared/EmptyState.js";
import { PageShell } from "../../components/shared/PageShell.js";
import { CronJobRow } from "../../components/cron/CronJobRow.js";
import { CronAddForm } from "../../components/cron/CronAddForm.js";
import { useAppState } from "../../components/layout/app-state-context.js";
import type { CronJobEntry } from "../../api/types.js";

export function CronChannelView() {
  const state = useAppState();
  const cronJobs = state.cronJobs;
  const agentNames = useMemo(
    () => state.agents.map((a) => a.name),
    [state.agents],
  );
  const channels = useMemo(
    () => Object.keys(state.channels ?? {}),
    [state.channels],
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<CronJobEntry | null>(null);

  const openAdd = () => {
    setEditingJob(null);
    setFormOpen(true);
  };

  const openEdit = (job: CronJobEntry) => {
    setEditingJob(job);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingJob(null);
  };

  return (
    <PageShell
      title="Cron"
      headerRight={
        <Button
          size="xs"
          variant="filled"
          leftSection={<IconPlus size={14} />}
          onClick={openAdd}
        >
          Add Job
        </Button>
      }
    >
      {cronJobs.length === 0 ? (
        <EmptyState
          icon={<IconCalendarTime size={32} />}
          message="No cron jobs configured"
        />
      ) : (
        <Stack gap={8}>
          {cronJobs.map((job) => (
            <CronJobRow key={job.jobName} job={job} onEdit={openEdit} />
          ))}
        </Stack>
      )}

      <CronAddForm
        opened={formOpen}
        onClose={closeForm}
        agentNames={agentNames}
        channels={channels}
        editJob={editingJob}
      />
    </PageShell>
  );
}
