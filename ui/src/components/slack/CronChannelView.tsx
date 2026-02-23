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
import { slack } from "../../theme/slack-theme.js";
import { ChannelHeader } from "./ChannelHeader.js";
import { CronJobRow } from "../cron/CronJobRow.js";
import { CronAddForm } from "../cron/CronAddForm.js";
import type { CronJobEntry } from "../../api/types.js";

interface CronChannelViewProps {
  cronJobs: CronJobEntry[];
  agentNames: string[];
  channels?: string[];
}

export function CronChannelView({
  cronJobs,
  agentNames,
  channels = [],
}: CronChannelViewProps) {
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
        backgroundColor: slack.mainBg,
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
            <Text size="sm" style={{ color: slack.textMuted }}>
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
