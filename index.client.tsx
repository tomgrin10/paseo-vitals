import type { PluginClientContext } from "@getpaseo/plugin/client";

import { VitalsSurface } from "./client/surface";

export default function contribute(client: PluginClientContext) {
  client.addSurface("dashboard", VitalsSurface);
  client.addSidebarItem({
    id: "vitals",
    title: "Host vitals",
    icon: "Gauge",
    surface: "dashboard",
  });
  client.addCommandCenterItem({
    id: "open-vitals",
    title: "Show host CPU, RAM, agents, and Docker",
    icon: "Gauge",
    keywords: ["cpu", "ram", "memory", "docker", "container", "host", "process"],
    context: "global",
    onSelect({ openSurface }) {
      openSurface("dashboard");
    },
  });
  return () => {};
}
