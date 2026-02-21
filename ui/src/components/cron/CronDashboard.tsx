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
import type { CronJobEntry } from "../../api/types.js";
import { CronJobRow } from "./CronJobRow.js";
import { CronAddForm } from "./CronAddForm.js";

interface CronDashboardProps {
  cronJobs: CronJobEntry[];
  agentNames: string[];
}

export function CronDashboard({ cronJobs, agentNames }: CronDashboardProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState("all");

  const filtered = useMemo(() => {
    if (filter === "all") return cronJobs;
    return cronJobs.filter((j) => j.scope === filter);
  }, [cronJobs, filter]);

  return (
    <Box p="md" style={{ height: "100%", overflow: "auto" }}>
      <Group justify="space-between" mb="md">
        <Text size="lg" fw={600}>
          Cron Jobs
        </Text>
        <Group gap="xs">
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
            Add
          </Button>
        </Group>
      </Group>

      {filtered.length === 0 ? (
        <Text c="dimmed" size="sm">
          No cron jobs configured
        </Text>
      ) : (
        <Stack gap={0}>
          {filtered.map((job) => (
            <CronJobRow key={`${job.agentName}:${job.jobName}`} job={job} />
          ))}
        </Stack>
      )}

      <CronAddForm
        opened={addOpen}
        onClose={() => setAddOpen(false)}
        agentNames={agentNames}
      />
    </Box>
  );
}
