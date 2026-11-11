import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const NullablePercentSchema = z.number().min(0).nullable();

export const AgentUsageSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  /** The agent's workspace, so the dashboard can open its Vitals panel; null when unknown. */
  workspaceId: z.string().nullable().default(null),
  provider: z.string(),
  status: z.string(),
  rssBytes: z.number().nonnegative(),
  cpuPercent: NullablePercentSchema,
  processCount: z.number().int().nonnegative(),
});

export const ContainerUsageSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: z.string(),
  status: z.string(),
  cpuPercent: z.number().nonnegative(),
  memoryBytes: z.number().nonnegative(),
  memoryPercent: z.number().nonnegative(),
  pids: z.number().int().nonnegative(),
  netIO: z.string(),
  blockIO: z.string(),
});

const DiskSchema = z.object({
  path: z.string(),
  totalBytes: z.number().nonnegative(),
  usedBytes: z.number().nonnegative(),
  availableBytes: z.number().nonnegative(),
  usedPercent: z.number().nonnegative(),
});

export const vitalsSnapshot = defineRpc({
  name: "vitals.snapshot",
  input: z.object({}),
  output: z.object({
    capturedAt: z.string(),
    host: z.object({
      hostname: z.string(),
      platform: z.string(),
      arch: z.string(),
      cpuModel: z.string(),
      logicalCores: z.number().int().positive(),
      cpuUsagePercent: NullablePercentSchema,
      loadAverage: z.array(z.number()).length(3),
      uptimeSeconds: z.number().nonnegative(),
    }),
    memory: z.object({
      totalBytes: z.number().positive(),
      usedBytes: z.number().nonnegative(),
      availableBytes: z.number().nonnegative(),
      freeBytes: z.number().nonnegative(),
      cacheBytes: z.number().nonnegative(),
      anonymousBytes: z.number().nonnegative(),
      swapTotalBytes: z.number().nonnegative(),
      swapUsedBytes: z.number().nonnegative(),
    }),
    disk: DiskSchema,
    paseo: z.object({
      daemonPid: z.number().int().positive().nullable(),
      daemonRssBytes: z.number().nonnegative(),
      coreRssBytes: z.number().nonnegative(),
      agentsRssBytes: z.number().nonnegative(),
      totalRssBytes: z.number().nonnegative(),
      processCount: z.number().int().nonnegative(),
      agents: z.array(AgentUsageSchema),
    }),
    docker: z.object({
      available: z.boolean(),
      error: z.string().nullable(),
      total: z.number().int().nonnegative(),
      running: z.number().int().nonnegative(),
      cpuPercent: z.number().nonnegative(),
      memoryBytes: z.number().nonnegative(),
      containers: z.array(ContainerUsageSchema),
    }),
    largestProcesses: z.array(z.object({
      pid: z.number().int().positive(),
      name: z.string(),
      rssBytes: z.number().nonnegative(),
      cpuPercent: NullablePercentSchema,
    })),
    warnings: z.array(z.string()),
  }),
});

export type VitalsSnapshot = z.infer<typeof vitalsSnapshot.output>;

export const PulseSampleSchema = z.object({
  at: z.number(),
  cpuPercent: NullablePercentSchema,
  memoryPercent: z.number().min(0),
  swapPercent: z.number().min(0),
});

/**
 * The light reading behind the sidebar meters, their history popover and the pressure pill:
 * host totals plus the last few minutes, from two small /proc files. No processes, no Docker.
 */
export const vitalsPulse = defineRpc({
  name: "vitals.pulse",
  input: z.object({}),
  output: z.object({
    capturedAt: z.string(),
    hostname: z.string(),
    uptimeSeconds: z.number().nonnegative(),
    logicalCores: z.number().int().positive(),
    loadAverage: z.array(z.number()).length(3),
    cpuPercent: NullablePercentSchema,
    memory: z.object({
      totalBytes: z.number().positive(),
      usedBytes: z.number().nonnegative(),
      availableBytes: z.number().nonnegative(),
      swapTotalBytes: z.number().nonnegative(),
      swapUsedBytes: z.number().nonnegative(),
    }),
    disk: DiskSchema,
    intervalMs: z.number().positive(),
    history: z.array(PulseSampleSchema),
  }),
});

export const AgentProcessSchema = z.object({
  pid: z.number().int().positive(),
  name: z.string(),
  /** Nesting below the agent's root process, 0 for the root. */
  depth: z.number().int().nonnegative(),
  rssBytes: z.number().nonnegative(),
  cpuPercent: NullablePercentSchema,
});

/** One agent's process tree: names from /proc/<pid>/comm only, never command lines. */
export const vitalsAgent = defineRpc({
  name: "vitals.agent",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({
    capturedAt: z.string(),
    agentId: z.string(),
    rssBytes: z.number().nonnegative(),
    cpuPercent: NullablePercentSchema,
    processCount: z.number().int().nonnegative(),
    /** Share of host RAM in use that this agent's tree holds, 0–100. */
    shareOfUsedPercent: z.number().min(0),
    processes: z.array(AgentProcessSchema),
    /** Processes left out of `processes` to keep the list short. */
    hiddenCount: z.number().int().nonnegative(),
    warnings: z.array(z.string()),
  }),
});

/**
 * The meters, pushed (Paseo 0.16 plugin subscriptions): one `vitals.pulse` reading on subscribe and
 * one per sample while the subscription stays open. Built as the plain contract object
 * `defineSubscription` returns, because 0.14/0.15 have no `defineSubscription` to call. Older hosts
 * keep reading `vitals.pulse` every five seconds.
 */
export const vitalsPulseStream = {
  name: "vitals.pulse-stream",
  input: z.object({}),
  event: vitalsPulse.output,
} as const;

export type VitalsPulse = z.infer<typeof vitalsPulse.output>;
export type PulseSample = z.infer<typeof PulseSampleSchema>;
export type AgentTree = z.infer<typeof vitalsAgent.output>;
export type AgentProcess = z.infer<typeof AgentProcessSchema>;
