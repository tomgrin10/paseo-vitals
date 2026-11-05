import { displayPreferences } from "./shared/display";
import type { PluginServerContext } from "@getpaseo/plugin/server";

import { collectAgentTree } from "./server/collect.ts";
import { contributeAgentTools, snapshot } from "./server/native-tools.ts";
import { createPulse } from "./server/pulse.ts";
import { vitalsAgent, vitalsPulse, vitalsSnapshot } from "./shared/vitals.ts";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(displayPreferences);
  const removeTools = contributeAgentTools(server);
  const pulse = createPulse();
  server.handle(vitalsSnapshot, (_input, { paseo }) => snapshot(paseo));
  server.handle(vitalsPulse, () => pulse.read());
  server.handle(vitalsAgent, ({ agentId }) => collectAgentTree(agentId));

  return () => {
    pulse.stop();
    removeTools();
  };
}
