import { defineAgentTool, type PluginHandlerContext, type PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { collectVitals } from "./collect.ts";
import { registerAgentTools } from "./agent-tools.ts";

type Api = PluginHandlerContext["paseo"];
export async function snapshot(paseo: Api, signal?: AbortSignal) {
  const agents: Awaited<ReturnType<Api["agents"]["list"]>>["entries"][number]["agent"][] = [];
  let cursor: string | undefined;
  try {
    do {
      if (signal?.aborted) throw new Error("Tool call cancelled.");
      const page: Awaited<ReturnType<Api["agents"]["list"]>> = await paseo.agents.list({ filter: { includeArchived: false }, page: { limit: 200, ...(cursor ? { cursor } : {}) }, signal });
      agents.push(...page.entries.map(entry => entry.agent));
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
  } catch {
    if (signal?.aborted) throw new Error("Tool call cancelled.");
    // Preserve host metrics and any agent pages already collected.
  }
  return collectVitals(agents);
}
export function contributeAgentTools(server: PluginServerContext) {
  return registerAgentTools(server, [defineAgentTool({
    name: "vitals_host_snapshot", description: "Read host CPU, memory, disk, Docker and Paseo process metrics. No environment variables or process command lines are exposed.",
    input: z.object({}).strict(),
    async execute(_, { paseo, signal }) {
      const result = await snapshot(paseo, signal);
      return { text: JSON.stringify(result), structuredContent: result };
    },
  })]);
}
