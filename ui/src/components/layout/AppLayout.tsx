import { useState, useCallback, useMemo } from "react";
import { AppShell } from "@mantine/core";
import { TopBar } from "./TopBar.js";
import { LeftPanel, type ViewId } from "./LeftPanel.js";
import { CenterPanel } from "./CenterPanel.js";
import { RightPanel } from "./RightPanel.js";
import { CronDashboard } from "../cron/CronDashboard.js";
import { CostDashboard } from "../cost/CostDashboard.js";
import { CommandPalette } from "../shared/CommandPalette.js";
import { useKeyboardShortcut } from "../../hooks/use-keyboard-shortcut.js";
import type { BootstrapState } from "../../api/types.js";

interface AppLayoutProps {
  state: BootstrapState;
}

export function AppLayout({ state }: AppLayoutProps) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [view, setView] = useState<ViewId>("org-chart");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const onSelectAgent = useCallback((name: string | null) => setSelectedAgent(name), []);
  const agentNames = useMemo(() => state.agents.map((a) => a.name), [state.agents]);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const closePalette = useCallback(() => setPaletteOpen(false), []);

  // Cmd+K (Mac) / Ctrl+K (other)
  useKeyboardShortcut("k", openPalette, { meta: true });
  useKeyboardShortcut("k", openPalette, { ctrl: true });

  return (
    <AppShell
      header={{ height: 50 }}
      navbar={{ width: 280, breakpoint: "sm" }}
      aside={{ width: 320, breakpoint: "md" }}
      padding="0"
    >
      <AppShell.Header>
        <TopBar
          officeName={state.officeName}
          agentCount={state.agents.length}
          schedulerRunning={state.scheduler.running}
          onOpenPalette={openPalette}
        />
      </AppShell.Header>

      <AppShell.Navbar>
        <LeftPanel
          agents={state.agents}
          hierarchy={state.hierarchy}
          selectedAgent={selectedAgent}
          onSelectAgent={onSelectAgent}
          view={view}
          onChangeView={setView}
        />
      </AppShell.Navbar>

      <AppShell.Main>
        {view === "org-chart" && <CenterPanel agentNames={agentNames} />}
        {view === "cron" && <CronDashboard cronJobs={state.cronJobs} agentNames={agentNames} />}
        {view === "cost" && <CostDashboard />}
      </AppShell.Main>

      <AppShell.Aside>
        <RightPanel selectedAgent={selectedAgent} />
      </AppShell.Aside>

      <CommandPalette
        opened={paletteOpen}
        onClose={closePalette}
        onNavigate={(v) => { setView(v); closePalette(); }}
      />
    </AppShell>
  );
}
