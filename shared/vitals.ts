import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const NullablePercentSchema = z.number().min(0).nullable();

export const AgentUsageSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
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
    disk: z.object({
      path: z.string(),
      totalBytes: z.number().nonnegative(),
      usedBytes: z.number().nonnegative(),
      availableBytes: z.number().nonnegative(),
      usedPercent: z.number().nonnegative(),
    }),
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
