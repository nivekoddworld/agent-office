import { useState, useMemo } from "react";
import {
  Box,
  Stack,
  Text,
  Group,
  Button,
  SegmentedControl,
} from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import { ChannelHeader } from "../../components/slack/ChannelHeader.js";
import { CronJobRow } from "../../components/cron/CronJobRow.js";
import { CronAddForm } from "../../components/cron/CronAddForm.js";
import { useAppState } from "../../components/layout/app-state-context.js";

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

  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    if (filter === "all") return cronJobs;
    return cronJobs.filter((j) => j.scope === filter);
  }, [cronJobs, filter]);

  return (
    <Box
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "var(--ao-bg-body)",
      }}
    >
      <ChannelHeader
        channel={{ kind: "system", name: "cron" }}
        description="Scheduled jobs and cron tasks"
      />

      <Box p="md" style={{ flex: 1, overflow: "auto" }}>
        <Group justify="space-between" mb="md">
          <SegmentedControl
            size="xs"
            value={filter}
            onChange={setFilter}
            data={[
              { value: "all", label: "All" },
              { value: "agent", label: "Agent" },
              { value: "office", label: "Office" },
            ]}
          />
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={() => setAddOpen(true)}
          >
            Add Job
          </Button>
        </Group>

        {filtered.length === 0 ? (
          <Box py="xl" style={{ textAlign: "center" }}>
            <Text size="sm" style={{ color: "var(--ao-text-muted)" }}>
              No cron jobs configured
            </Text>
          </Box>
        ) : (
          <Stack gap={0}>
            {filtered.map((job) => (
              <CronJobRow key={`${job.agentName}:${job.jobName}`} job={job} />
            ))}
          </Stack>
        )}
      </Box>

      <CronAddForm
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        agentNames={agentNames}
        channels={channels}
      />
    </Box>
  );
}
