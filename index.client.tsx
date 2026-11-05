import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";

import { pressureLabel } from "./shared/pressure";
import { vitalsPulse } from "./shared/vitals";
import { agentPanel } from "./client/agent-panel";
import { observeAgents } from "./client/agents";
import { levelText } from "./client/charts";
import { DEFAULT_DISPLAY, contributeDisplay, type Display } from "./client/display";
import { footerItem } from "./client/footer";
import { Chip } from "./client/kit";
import { createLive, useLive } from "./client/live";
import { contributePressurePill } from "./client/pill";
import { sidebarVisibility } from "./client/sidebar-visibility";
import { AGENT_PANEL_ID, dashboard } from "./client/surface";

export default function contribute(client: PluginClientContext) {
  const live = createLive(() => client.rpc(vitalsPulse, {}));
  let display: Display = DEFAULT_DISPLAY;

  const removeScreen = client.addScreen({ id: "dashboard", title: "Host vitals", Component: dashboard(client, live) });
  const removePanel = client.addAgentPanel({ id: AGENT_PANEL_ID, title: "Vitals", icon: "Gauge", Component: agentPanel(client) });

  function VitalsRow({ theme, currentScreen, openScreen }: PluginSidebarItemProps) {
    useLive(live);
    const pressure = live.pressure();
    return (
      <SidebarRow icon="Gauge" label="Host vitals" active={currentScreen?.screenId === "dashboard"}
        onPress={() => openScreen({ screenId: "dashboard" })}
        trailing={pressure.level === "ok" ? undefined : <Chip theme={theme} label={pressureLabel(pressure)} color={levelText(theme.colors, pressure.level)} />} />
    );
  }
  const Footer = footerItem(live);
  const sidebar = sidebarVisibility(() => client.addSidebarHeaderItem({ id: "vitals", title: "Host vitals", Component: VitalsRow }));
  const footer = sidebarVisibility(() => client.addSidebarFooterItem({ id: "vitals-meters", title: "Host vitals meters", Component: Footer }));
  // Register before the saved preference arrives, so an already-open route resolves on first render.
  sidebar.set(true);
  footer.set(true);

  const agents = observeAgents(client);
  const pills = contributePressurePill(client, live, agents, () => display.showPressurePill);
  // The pill must know about pressure with nothing else open, so it keeps the light poll alive.
  let releasePillWatch: (() => void) | null = live.watch();

  const removeDisplay = contributeDisplay(client, (values) => {
    display = values;
    sidebar.set(values.showSidebar);
    footer.set(values.showFooter);
    if (values.showPressurePill && !releasePillWatch) releasePillWatch = live.watch();
    if (!values.showPressurePill && releasePillWatch) { releasePillWatch(); releasePillWatch = null; }
    pills.sync();
  });

  const removeOpen = client.addCommandCenterItem({
    id: "open-vitals",
    title: "Host vitals: CPU, RAM, agents and Docker",
    icon: "Gauge",
    keywords: ["vitals", "cpu", "ram", "memory", "swap", "disk", "docker", "container", "host", "process", "load"],
    context: "global",
    onSelect({ openScreen }) { openScreen({ screenId: "dashboard" }); },
  });
  const removeProcesses = client.addCommandCenterItem({
    id: "agent-processes",
    title: "Show this agent's processes",
    icon: "ListTree",
    keywords: ["vitals", "processes", "memory", "cpu", "agent"],
    context: "agent",
    onSelect({ openPanel }) { openPanel(AGENT_PANEL_ID); },
  });

  return () => {
    removeOpen();
    removeProcesses();
    releasePillWatch?.();
    pills.dispose();
    void agents.dispose();
    removeDisplay();
    sidebar.dispose();
    footer.dispose();
    removePanel();
    removeScreen();
    live.dispose();
  };
}
