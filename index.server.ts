import { displayPreferences } from "./shared/display";
import type { PluginServerContext } from "@getpaseo/plugin/server";

import { contributeAgentTools, snapshot } from "./server/native-tools.ts";
import { vitalsSnapshot } from "./shared/vitals.ts";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(displayPreferences);
  const removeTools = contributeAgentTools(server);
  server.handle(vitalsSnapshot, (_input, { paseo }) => snapshot(paseo));

  return removeTools;
}
