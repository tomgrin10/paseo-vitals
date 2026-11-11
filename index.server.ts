import { displayPreferences } from "./shared/display";
import type { PluginServerContext } from "@getpaseo/plugin/server";

import { collectAgentTree } from "./server/collect.ts";
import { contributeAgentTools, snapshot } from "./server/native-tools.ts";
import { createPulse } from "./server/pulse.ts";
import { vitalsAgent, vitalsPulse, vitalsPulseStream, vitalsSnapshot } from "./shared/vitals.ts";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(displayPreferences);
  const removeTools = contributeAgentTools(server);
  const pulse = createPulse();
  server.handle(vitalsSnapshot, (_input, { paseo }) => snapshot(paseo));
  server.handle(vitalsPulse, () => pulse.read());
  server.handle(vitalsAgent, ({ agentId }) => collectAgentTree(agentId));
  servePulseStream(server, pulse);

  return () => {
    pulse.stop();
    removeTools();
  };
}

type Pulse = ReturnType<typeof createPulse>;
interface SubscriptionContext { push(event: unknown): Promise<void>; signal: AbortSignal }
type SubscriptionHandle = (contract: typeof vitalsPulseStream, handler: (input: unknown, context: SubscriptionContext) => void) => void;

/**
 * Paseo 0.16 serves `vitals.pulse-stream` (a contract with `event`, not `output`) through the same
 * `server.handle`. The handler returns nothing, so the subscription stays open until the client
 * releases it, disconnects, or the plugin stops; the abort removes this subscriber from the sampler.
 * On 0.15 the client never subscribes, and a host that refuses the registration only loses the push.
 */
export function servePulseStream(server: PluginServerContext, pulse: Pulse) {
  try {
    (server.handle as unknown as SubscriptionHandle)(vitalsPulseStream, (_input, { push, signal }) => {
      if (signal.aborted) return;
      const release = pulse.watch((next) => { void push(next).catch(() => undefined); });
      signal.addEventListener("abort", release, { once: true });
    });
  } catch {
    // An older host that can't register subscriptions keeps the five-second reads.
  }
}
