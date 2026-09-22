import type { PluginHandlerContext, PluginServerContext } from "@getpaseo/plugin/server";

import { collectVitals } from "./server/collect.ts";
import { vitalsSnapshot } from "./shared/vitals.ts";

type PaseoApi = PluginHandlerContext["paseo"];
type PaseoAgent = Awaited<ReturnType<PaseoApi["agents"]["list"]>>["entries"][number]["agent"];

export default function contribute(server: PluginServerContext) {
  server.handle(vitalsSnapshot, async (_input, { paseo }) => {
    let agents: PaseoAgent[] = [];
    try {
      const result = await paseo.agents.list({
        filter: { includeArchived: false },
        page: { limit: 200 },
      });
      agents = result.entries.map((entry) => entry.agent);
    } catch {
      // Host metrics are still useful while the agent catalogue is unavailable.
    }
    return collectVitals(agents);
  });

  return () => {};
}
