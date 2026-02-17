import { Tabs } from "@mantine/core";
import { FeedTimeline } from "../feed/FeedTimeline.js";
import { MailboxView } from "../mailbox/MailboxView.js";

interface CenterPanelProps {
  agentNames: string[];
}

export function CenterPanel({ agentNames }: CenterPanelProps) {
  return (
    <Tabs
      defaultValue="feed"
      style={{ height: "100%", display: "flex", flexDirection: "column" }}
    >
      <Tabs.List>
        <Tabs.Tab value="feed">Feed</Tabs.Tab>
        <Tabs.Tab value="mailbox">Mailbox</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="feed" style={{ flex: 1, minHeight: 0 }}>
        <FeedTimeline agentNames={agentNames} />
      </Tabs.Panel>

      <Tabs.Panel value="mailbox" style={{ flex: 1, minHeight: 0 }}>
        <MailboxView agentNames={agentNames} />
      </Tabs.Panel>
    </Tabs>
  );
}
