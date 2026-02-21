import { useState, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Panel,
  useReactFlow,
  type NodeMouseHandler,
  type NodeTypes,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ActionIcon } from "@mantine/core";
import { IconPlus } from "@tabler/icons-react";
import type { AgentInfo, AgentHierarchy } from "../../api/types.js";
import { useCommand } from "../../api/use-command.js";
import { useOrgLayout, type OrgNode } from "./use-org-layout.js";
import { AgentNode } from "./AgentNode.js";
import { NodeActions } from "./NodeActions.js";
import { AddNodeModal } from "./AddNodeModal.js";

const nodeTypes: NodeTypes = { agentNode: AgentNode };
const ROOT_ID = "__user__";

interface OrgChartProps {
  agents: AgentInfo[];
  hierarchy: Record<string, AgentHierarchy>;
  onSelectAgent: (name: string | null) => void;
}

export function OrgChart({ agents, hierarchy, onSelectAgent }: OrgChartProps) {
  const { nodes, edges } = useOrgLayout(agents, hierarchy);
  const [hireOpen, setHireOpen] = useState(false);
  const [defaultManager, setDefaultManager] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    agentName: string;
    x: number;
    y: number;
  } | null>(null);
  const command = useCommand();
  const reactFlow = useReactFlow();

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const agentName = node.id === ROOT_ID ? null : node.id;
      onSelectAgent(agentName);
    },
    [onSelectAgent],
  );

  const onNodeContextMenu: NodeMouseHandler = useCallback((event, node) => {
    if (node.id === ROOT_ID) return;
    event.preventDefault();
    setContextMenu({ agentName: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const onNodeDragStop: NodeMouseHandler = useCallback(
    (_event, draggedNode) => {
      if (draggedNode.id === ROOT_ID) return;

      // Find nearest node the dragged node was dropped on
      const dragPos = {
        x: draggedNode.position.x + 100,
        y: draggedNode.position.y + 40,
      };

      let closestNode: Node<OrgNode> | null = null;
      let closestDist = 120; // proximity threshold

      for (const node of reactFlow.getNodes()) {
        if (node.id === draggedNode.id) continue;
        const nx = node.position.x + 100;
        const ny = node.position.y + 40;
        const dist = Math.sqrt((dragPos.x - nx) ** 2 + (dragPos.y - ny) ** 2);
        if (dist < closestDist) {
          closestDist = dist;
          closestNode = node as Node<OrgNode>;
        }
      }

      if (!closestNode) return;

      const newManager = closestNode.id === ROOT_ID ? null : closestNode.id;
      const currentManager = hierarchy[draggedNode.id]?.manager ?? null;
      if (newManager === currentManager) return;

      // Client-side cycle pre-check
      if (newManager) {
        const visited = new Set<string>([draggedNode.id]);
        let current: string | undefined = newManager;
        while (current) {
          if (visited.has(current)) return; // would create cycle
          visited.add(current);
          current = hierarchy[current]?.manager ?? undefined;
        }
      }

      command.mutate({
        command: newManager
          ? `agent-set-manager ${draggedNode.id} ${newManager}`
          : `agent-set-manager ${draggedNode.id} __clear__`,
      });
    },
    [hierarchy, command, reactFlow],
  );

  const openHireWithManager = (manager: string) => {
    setDefaultManager(manager);
    setHireOpen(true);
  };

  const agentNames = agents.map((a) => a.name);

  return (
    <>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeContextMenu={onNodeContextMenu}
        onNodeDragStop={onNodeDragStop}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        style={{ height: "100%", width: "100%" }}
      >
        <Background gap={16} size={1} color="var(--mantine-color-dark-5)" />
        <Controls showInteractive={false} />
        <Panel position="top-right">
          <ActionIcon
            variant="filled"
            color="blue"
            size="lg"
            onClick={() => {
              setDefaultManager(null);
              setHireOpen(true);
            }}
          >
            <IconPlus size={18} />
          </ActionIcon>
        </Panel>
      </ReactFlow>

      {contextMenu && (
        <NodeActions
          agentName={contextMenu.agentName}
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          onHireReport={openHireWithManager}
        />
      )}

      <AddNodeModal
        opened={hireOpen}
        onClose={() => setHireOpen(false)}
        agentNames={agentNames}
        defaultManager={defaultManager}
      />
    </>
  );
}
