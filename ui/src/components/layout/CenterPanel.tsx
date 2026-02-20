import { Tabs } from "@mantine/core";
import { FeedTimeline } from "../feed/FeedTimeline.js";
import { MessagesView } from "../mailbox/MessagesView.js";

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
        <Tabs.Tab value="messages">Messages</Tabs.Tab>
      </Tabs.List>

      <Tabs.Panel value="feed" style={{ flex: 1, minHeight: 0 }}>
        <FeedTimeline agentNames={agentNames} />
      </Tabs.Panel>

      <Tabs.Panel value="messages" style={{ flex: 1, minHeight: 0 }}>
        <MessagesView agentNames={agentNames} />
      </Tabs.Panel>
    </Tabs>
  );
}
