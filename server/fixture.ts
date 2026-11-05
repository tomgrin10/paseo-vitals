import { readFileSync } from "node:fs";

import type { PluginHandlerContext } from "@getpaseo/plugin/server";

import { diskPercent, share } from "../shared/pressure.ts";
import type { AgentTree, PulseSample, VitalsPulse, VitalsSnapshot } from "../shared/vitals.ts";

type PaseoAgent = Awaited<ReturnType<PluginHandlerContext["paseo"]["agents"]["list"]>>["entries"][number]["agent"];

/**
 * Demo mode for screenshots: when PASEO_VITALS_FIXTURE names a JSON file, every reading comes from
 * it instead of this machine, so README media never shows a real hostname, process or container.
 * Agent titles, providers and workspaces still come from Paseo when the fixture's ids match.
 * Unset in normal use; nothing here runs then.
 */

interface FixtureProcess { name: string; depth: number; rssBytes: number; cpuPercent: number }
interface FixtureAgent { id: string; title?: string; provider?: string; rssBytes: number; cpuPercent: number; processes: FixtureProcess[] }
interface FixtureFile {
  host: Omit<VitalsSnapshot["host"], "cpuUsagePercent">;
  /** CPU follows base + swing·wave over periodSeconds, so recordings move. */
  cpu: { base: number; swing: number; periodSeconds: number };
  memory: VitalsSnapshot["memory"] & { swingBytes?: number };
  disk: { totalBytes: number; usedBytes: number; availableBytes: number };
  paseo: { daemonRssBytes: number; coreRssBytes: number; processCount: number };
  agents: FixtureAgent[];
  docker: VitalsSnapshot["docker"];
  largestProcesses: VitalsSnapshot["largestProcesses"];
  warnings?: string[];
}

function wave(t: number, periodSeconds: number): number {
  const x = (t / 1000) * (2 * Math.PI / periodSeconds);
  return 0.6 * Math.sin(x) + 0.3 * Math.sin(x * 2.7 + 1) + 0.1 * Math.sin(x * 7.3);
}

function load(path: string): FixtureFile | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as FixtureFile;
  } catch {
    return null;
  }
}

function cpuAt(file: FixtureFile, t: number): number {
  return Math.max(0, Math.min(100, Math.round((file.cpu.base + file.cpu.swing * wave(t, file.cpu.periodSeconds)) * 10) / 10));
}

function memoryAt(file: FixtureFile, t: number) {
  const swing = (file.memory.swingBytes ?? 0) * wave(t, file.cpu.periodSeconds * 3);
  const usedBytes = Math.max(0, Math.min(file.memory.totalBytes, file.memory.usedBytes + swing));
  return { ...file.memory, usedBytes, availableBytes: file.memory.totalBytes - usedBytes };
}

function disk(file: FixtureFile): VitalsSnapshot["disk"] {
  return { path: "/", ...file.disk, usedPercent: Math.round(diskPercent(file.disk) * 10) / 10 };
}

export function fixture() {
  const path = process.env.PASEO_VITALS_FIXTURE;
  if (!path) return null;
  const file = load(path);
  if (!file) return null;
  return {
    snapshot(agents: PaseoAgent[]): VitalsSnapshot {
      const now = Date.now();
      const meta = new Map(agents.map((agent) => [agent.id, agent]));
      const memory = memoryAt(file, now);
      const agentUsage = file.agents.map((agent, index) => {
        const known = meta.get(agent.id);
        return {
          id: agent.id,
          title: known?.title ?? agent.title ?? null,
          workspaceId: known?.workspaceId ?? null,
          provider: agent.provider ?? known?.provider ?? "claude",
          status: known?.status ?? "running",
          rssBytes: agent.rssBytes,
          cpuPercent: Math.max(0, Math.round((agent.cpuPercent * (1 + 0.5 * wave(now + index * 7_000, 40))) * 10) / 10),
          processCount: agent.processes.length,
        };
      });
      const agentsRssBytes = agentUsage.reduce((sum, agent) => sum + agent.rssBytes, 0);
      return {
        capturedAt: new Date(now).toISOString(),
        host: { ...file.host, cpuUsagePercent: cpuAt(file, now) },
        memory: { ...memory, freeBytes: Math.max(0, memory.availableBytes - memory.cacheBytes) },
        disk: disk(file),
        paseo: {
          daemonPid: 4242,
          daemonRssBytes: file.paseo.daemonRssBytes,
          coreRssBytes: file.paseo.coreRssBytes,
          agentsRssBytes,
          totalRssBytes: file.paseo.coreRssBytes + agentsRssBytes,
          processCount: file.paseo.processCount,
          agents: agentUsage,
        },
        docker: file.docker,
        largestProcesses: file.largestProcesses,
        warnings: file.warnings ?? [],
      };
    },
    pulse(): VitalsPulse {
      const now = Date.now();
      const interval = 5_000;
      const history: PulseSample[] = [];
      for (let i = 59; i >= 0; i -= 1) {
        const at = Math.floor(now / interval) * interval - i * interval;
        const memory = memoryAt(file, at);
        history.push({
          at,
          cpuPercent: cpuAt(file, at),
          memoryPercent: share(memory.usedBytes, memory.totalBytes),
          swapPercent: share(memory.swapUsedBytes, memory.swapTotalBytes),
        });
      }
      const memory = memoryAt(file, now);
      return {
        capturedAt: new Date(now).toISOString(),
        hostname: file.host.hostname,
        uptimeSeconds: file.host.uptimeSeconds,
        logicalCores: file.host.logicalCores,
        loadAverage: file.host.loadAverage,
        cpuPercent: history.at(-1)!.cpuPercent,
        memory: {
          totalBytes: memory.totalBytes,
          usedBytes: memory.usedBytes,
          availableBytes: memory.availableBytes,
          swapTotalBytes: memory.swapTotalBytes,
          swapUsedBytes: memory.swapUsedBytes,
        },
        disk: disk(file),
        intervalMs: interval,
        history,
      };
    },
    agentTree(agentId: string): AgentTree {
      const now = Date.now();
      const agent = file.agents.find((candidate) => candidate.id === agentId);
      const memory = memoryAt(file, now);
      const processes = (agent?.processes ?? []).map((row, index) => ({
        pid: 31_000 + index * 7,
        name: row.name,
        depth: row.depth,
        rssBytes: row.rssBytes,
        cpuPercent: Math.max(0, Math.round(row.cpuPercent * (1 + 0.5 * wave(now + index * 5_000, 30)) * 10) / 10),
      }));
      const rssBytes = processes.reduce((sum, row) => sum + row.rssBytes, 0);
      return {
        capturedAt: new Date(now).toISOString(),
        agentId,
        rssBytes,
        cpuPercent: agent ? Math.round(processes.reduce((sum, row) => sum + (row.cpuPercent ?? 0), 0) * 10) / 10 : null,
        processCount: processes.length,
        shareOfUsedPercent: share(rssBytes, memory.usedBytes),
        processes,
        hiddenCount: 0,
        warnings: [],
      };
    },
  };
}
