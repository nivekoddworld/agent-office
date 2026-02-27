import { createBrowserRouter, Navigate } from "react-router-dom";
import { RootLayout } from "./components/layout/RootLayout.js";
import { KanbanBoard } from "./pages/tasks/KanbanBoard.js";
import { CronChannelView } from "./pages/cron/CronChannelView.js";
import { CostPanel } from "./pages/cost/CostPanel.js";
import { SettingsPanel } from "./pages/settings/SettingsPanel.js";
import { OfficeDebugPanel } from "./pages/debug/OfficeDebugPanel.js";
import { OrgChartPanel } from "./pages/org-chart/OrgChartPanel.js";
import { DmView } from "./pages/dm/DmView.js";
import { ConversationView } from "./pages/channel/ConversationView.js";
import { AllFilesPanel } from "./pages/files/AllFilesPanel.js";
import { HeartbeatView } from "./pages/heartbeat/HeartbeatView.js";

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { index: true, element: <Navigate to="/tasks" replace /> },
      { path: "tasks", element: <KanbanBoard /> },
      { path: "cron", element: <CronChannelView /> },
      { path: "heartbeat", element: <HeartbeatView /> },
      { path: "files", element: <AllFilesPanel /> },
      { path: "cost", element: <CostPanel /> },
      { path: "settings", element: <SettingsPanel /> },
      { path: "debug", element: <OfficeDebugPanel /> },
      { path: "org-chart", element: <OrgChartPanel /> },
      { path: "dm/:agentName", element: <DmView /> },
      { path: "channels/:name", element: <ConversationView /> },
      { path: "*", element: <Navigate to="/tasks" replace /> },
    ],
  },
]);
