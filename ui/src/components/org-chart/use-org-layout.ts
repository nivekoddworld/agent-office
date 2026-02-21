import { useMemo } from "react";
import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";
import type { AgentInfo, AgentHierarchy } from "../../api/types.js";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const ROOT_ID = "__user__";

export type OrgNode = Record<string, unknown> & {
  agentName: string | null; // null for root "user" node
  label: string;
  status: "idle" | "running" | "dead" | "root";
  model: string;
  priority: number;
  queueDepth: number;
};

/** Compute dagre-laid-out reactflow nodes + edges from agents & hierarchy. */
export function useOrgLayout(
  agents: AgentInfo[],
  hierarchy: Record<string, AgentHierarchy>,
) {
  return useMemo(() => {
    const g = new dagre.graphlib.Graph();
    g.setGraph({ rankdir: "TB", nodesep: 40, ranksep: 60 });
    g.setDefaultEdgeLabel(() => ({}));

    // Root "user" node
    g.setNode(ROOT_ID, { width: NODE_WIDTH, height: NODE_HEIGHT });

    // Agent nodes
    for (const agent of agents) {
      g.setNode(agent.name, { width: NODE_WIDTH, height: NODE_HEIGHT });
    }

    // Edges from hierarchy
    for (const agent of agents) {
      const h = hierarchy[agent.name];
      const manager = h?.manager;
      if (manager && agents.some((a) => a.name === manager)) {
        g.setEdge(manager, agent.name);
      } else {
        // No manager or manager not found — attach to root
        g.setEdge(ROOT_ID, agent.name);
      }
    }

    dagre.layout(g);

    const nodes: Node<OrgNode>[] = [];

    // Root node
    const rootPos = g.node(ROOT_ID);
    if (rootPos) {
      nodes.push({
        id: ROOT_ID,
        type: "agentNode",
        position: {
          x: rootPos.x - NODE_WIDTH / 2,
          y: rootPos.y - NODE_HEIGHT / 2,
        },
        data: {
          agentName: null,
          label: "You",
          status: "root",
          model: "",
          priority: 0,
          queueDepth: 0,
        },
      });
    }

    // Agent nodes
    for (const agent of agents) {
      const pos = g.node(agent.name);
      if (!pos) continue;
      nodes.push({
        id: agent.name,
        type: "agentNode",
        position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - NODE_HEIGHT / 2 },
        data: {
          agentName: agent.name,
          label: agent.name,
          status: agent.status,
          model: agent.model,
          priority: agent.priority,
          queueDepth: agent.queueDepth,
        },
      });
    }

    const edges: Edge[] = (g.edges() ?? []).map((e) => ({
      id: `${e.v}-${e.w}`,
      source: e.v!,
      target: e.w!,
      type: "smoothstep",
      animated: false,
      style: { stroke: "var(--mantine-color-dark-4)" },
    }));

    return { nodes, edges };
  }, [agents, hierarchy]);
}
