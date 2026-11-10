import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { diskPercent, share } from "../shared/pressure.ts";
import type { AgentProcess, AgentTree, VitalsSnapshot } from "../shared/vitals.ts";
import { fixture } from "./fixture.ts";

type PaseoApi = PluginHandlerContext["paseo"];
type PaseoAgent = Awaited<ReturnType<PaseoApi["agents"]["list"]>>["entries"][number]["agent"];

const execFileAsync = promisify(execFile);
const PAGE_BYTES = 4096;
const CLOCK_TICKS = 100;
const CACHE_MS = 3_000;

interface ProcessRow {
  pid: number;
  ppid: number;
  name: string;
  rssBytes: number;
  cpuTicks: number;
  agentId: string | null;
}

interface CpuSample {
  totalTicks: number;
  idleTicks: number;
  processTicks: Map<number, number>;
  at: number;
}

let previousSample: CpuSample | null = null;

export function parseByteSize(value: string): number {
  const match = value.trim().match(/^([\d.]+)\s*([kmgtpe]?i?b)?$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "b").toLowerCase();
  const powers: Record<string, number> = {
    b: 0, kb: 1, kib: 1, mb: 2, mib: 2, gb: 3, gib: 3, tb: 4, tib: 4,
  };
  const power = powers[unit];
  return Number.isFinite(amount) && power !== undefined ? Math.round(amount * 1024 ** power) : 0;
}

export function parseMeminfo(text: string) {
  const values = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = line.match(/^([^:]+):\s+(\d+)\s+kB$/);
    if (match) values.set(match[1]!, Number(match[2]) * 1024);
  }
  const get = (key: string) => values.get(key) ?? 0;
  const totalBytes = get("MemTotal");
  const freeBytes = get("MemFree");
  const cacheBytes = get("Cached") + get("SReclaimable") + get("Buffers");
  const availableBytes = get("MemAvailable") || Math.min(totalBytes, freeBytes + cacheBytes);
  const swapTotalBytes = get("SwapTotal");
  return {
    totalBytes,
    usedBytes: Math.max(0, totalBytes - availableBytes),
    availableBytes,
    freeBytes,
    cacheBytes,
    anonymousBytes: get("AnonPages") + get("Shmem"),
    swapTotalBytes,
    swapUsedBytes: Math.max(0, swapTotalBytes - get("SwapFree")),
  };
}

function parseProcStat(text: string): { ppid: number; cpuTicks: number; rssBytes: number } | null {
  const close = text.lastIndexOf(") ");
  if (close < 0) return null;
  const fields = text.slice(close + 2).trim().split(/\s+/);
  const ppid = Number(fields[1]);
  const user = Number(fields[11]);
  const system = Number(fields[12]);
  const rssPages = Number(fields[21]);
  if (![ppid, user, system, rssPages].every(Number.isFinite)) return null;
  return { ppid, cpuTicks: user + system, rssBytes: Math.max(0, rssPages * PAGE_BYTES) };
}

function readAgentId(environ: Buffer): string | null {
  for (const entry of environ.toString("utf8").split("\0")) {
    if (entry.startsWith("PASEO_AGENT_ID=")) return entry.slice("PASEO_AGENT_ID=".length) || null;
  }
  return null;
}

async function readProcesses(): Promise<ProcessRow[]> {
  if (process.platform !== "linux") return [];
  const entries = await fs.readdir("/proc", { withFileTypes: true });
  const pids = entries
    .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
    .map((entry) => Number(entry.name));

  const rows = await Promise.all(pids.map(async (pid): Promise<ProcessRow | null> => {
    try {
      const base = `/proc/${pid}`;
      const [stat, comm] = await Promise.all([
        fs.readFile(`${base}/stat`, "utf8"),
        fs.readFile(`${base}/comm`, "utf8"),
      ]);
      const parsed = parseProcStat(stat);
      if (!parsed) return null;
      return {
        pid,
        ppid: parsed.ppid,
        name: comm.trim().slice(0, 80) || `pid ${pid}`,
        rssBytes: parsed.rssBytes,
        cpuTicks: parsed.cpuTicks,
        agentId: null,
      };
    } catch {
      return null;
    }
  }));
  return rows.filter((row): row is ProcessRow => row !== null);
}

function findDaemonPid(rows: ProcessRow[]): number | null {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  let cursor = byPid.get(process.pid) ?? null;
  while (cursor) {
    if (cursor.name === "Paseo Daemon") return cursor.pid;
    cursor = byPid.get(cursor.ppid) ?? null;
  }
  return rows.find((row) => row.name === "Paseo Daemon")?.pid ?? null;
}

function descendantsOf(rootPid: number | null, rows: ProcessRow[]): Set<number> {
  if (rootPid === null) return new Set();
  const children = new Map<number, number[]>();
  for (const row of rows) {
    const list = children.get(row.ppid) ?? [];
    list.push(row.pid);
    children.set(row.ppid, list);
  }
  const result = new Set<number>();
  const pending = [rootPid];
  while (pending.length > 0) {
    const pid = pending.pop()!;
    if (result.has(pid)) continue;
    result.add(pid);
    pending.push(...(children.get(pid) ?? []));
  }
  return result;
}

async function attachAgentIds(rows: ProcessRow[], paseoPids: Set<number>): Promise<void> {
  await Promise.all(rows.filter((row) => paseoPids.has(row.pid)).map(async (row) => {
    try {
      row.agentId = readAgentId(await fs.readFile(`/proc/${row.pid}/environ`));
    } catch {
      // A short-lived process may disappear between /proc reads.
    }
  }));

  const byPid = new Map(rows.map((row) => [row.pid, row]));
  for (const row of rows) {
    if (!paseoPids.has(row.pid) || row.agentId) continue;
    let parent = byPid.get(row.ppid);
    while (parent && paseoPids.has(parent.pid)) {
      if (parent.agentId) {
        row.agentId = parent.agentId;
        break;
      }
      parent = byPid.get(parent.ppid);
    }
  }
}

/**
 * Linux: the aggregate line of /proc/stat. iowait counts as idle; steal counts as busy, since on a
 * VM it is CPU time the guest wanted and did not get. os.cpus() omits both.
 */
export function parseProcStatCpu(text: string): { totalTicks: number; idleTicks: number } | null {
  const line = text.split("\n", 1)[0] ?? "";
  if (!line.startsWith("cpu ")) return null;
  const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = line
    .trim().split(/\s+/).slice(1).map(Number);
  return { idleTicks: idle + iowait, totalTicks: user + nice + system + idle + iowait + irq + softirq + steal };
}

export async function readSystemCpu(): Promise<{ totalTicks: number; idleTicks: number }> {
  if (process.platform === "linux") {
    try {
      const parsed = parseProcStatCpu(await fs.readFile("/proc/stat", "utf8"));
      if (parsed) return parsed;
    } catch {
      // Fall back to os.cpus below.
    }
  }
  let totalTicks = 0;
  let idleTicks = 0;
  for (const cpu of os.cpus()) {
    idleTicks += cpu.times.idle;
    totalTicks += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { totalTicks, idleTicks };
}

export function percent(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

async function cpuValues(rows: ProcessRow[]) {
  const now = Date.now();
  const system = await readSystemCpu();
  const processTicks = new Map(rows.map((row) => [row.pid, row.cpuTicks]));
  const sample: CpuSample = { ...system, processTicks, at: now };
  const previous = previousSample;
  previousSample = sample;
  if (!previous) return { host: null, byPid: new Map<number, number>() };

  const totalDelta = sample.totalTicks - previous.totalTicks;
  const idleDelta = sample.idleTicks - previous.idleTicks;
  const elapsedSeconds = (now - previous.at) / 1000;
  const host = totalDelta > 0 ? percent(((totalDelta - idleDelta) / totalDelta) * 100) : null;
  const byPid = new Map<number, number>();
  if (elapsedSeconds > 0) {
    for (const row of rows) {
      const before = previous.processTicks.get(row.pid);
      if (before !== undefined && row.cpuTicks >= before) {
        byPid.set(row.pid, percent((row.cpuTicks - before) / CLOCK_TICKS / elapsedSeconds * 100));
      }
    }
  }
  return { host, byPid };
}

function sumCpu(rows: ProcessRow[], byPid: Map<number, number>): number | null {
  let found = false;
  let total = 0;
  for (const row of rows) {
    const value = byPid.get(row.pid);
    if (value !== undefined) {
      total += value;
      found = true;
    }
  }
  return found ? percent(total) : null;
}

/** Parses `memory_pressure -Q` lines such as `System-wide memory free percentage: 42%`. */
export function parseMemoryPressureFreePercent(text: string): number | null {
  const match = /free percentage:\s*(\d+)/.exec(text);
  if (!match) return null;
  const freePct = Number(match[1]);
  return Number.isFinite(freePct) && freePct >= 0 && freePct <= 100 ? freePct : null;
}

/** Parses `sysctl -n vm.swapusage` (`total = 4096.00M  used = 3052.69M  free = 1043.31M`). */
export function parseDarwinSwapUsage(text: string): { swapTotalBytes: number; swapUsedBytes: number } | null {
  const mib = (key: string) => Number(new RegExp(`${key} = ([\\d.]+)M`).exec(text)?.[1] ?? 0) * 1024 ** 2;
  const swapTotalBytes = Math.round(mib("total"));
  if (!swapTotalBytes) return null;
  return { swapTotalBytes, swapUsedBytes: Math.round(mib("used")) };
}

type HostMemory = VitalsSnapshot["memory"];

async function readDarwinMemory(): Promise<HostMemory> {
  const totalBytes = os.totalmem();
  const fallbackAvailable = os.freemem();
  try {
    const [pressure, swap] = await Promise.all([
      execFileAsync("memory_pressure", ["-Q"], { timeout: 5_000 }),
      execFileAsync("sysctl", ["-n", "vm.swapusage"], { timeout: 5_000 }).catch(() => ({ stdout: "" as string | Buffer })),
    ]);
    const freePct = parseMemoryPressureFreePercent(String(pressure.stdout ?? ""));
    if (freePct !== null) {
      const availableBytes = Math.round(totalBytes * (freePct / 100));
      const usedBytes = Math.max(0, totalBytes - availableBytes);
      const swapUsage = parseDarwinSwapUsage(String(swap.stdout ?? ""));
      return {
        totalBytes,
        usedBytes,
        availableBytes,
        freeBytes: availableBytes,
        cacheBytes: 0,
        anonymousBytes: 0,
        swapTotalBytes: swapUsage?.swapTotalBytes ?? 0,
        swapUsedBytes: swapUsage?.swapUsedBytes ?? 0,
      };
    }
  } catch {
    // Fall back when memory_pressure is missing or errors.
  }
  return {
    totalBytes,
    usedBytes: totalBytes - fallbackAvailable,
    availableBytes: fallbackAvailable,
    freeBytes: fallbackAvailable,
    cacheBytes: 0,
    anonymousBytes: 0,
    swapTotalBytes: 0,
    swapUsedBytes: 0,
  };
}

export async function readMemory(): Promise<HostMemory> {
  if (process.platform === "linux") {
    return parseMeminfo(await fs.readFile("/proc/meminfo", "utf8"));
  }
  if (process.platform === "darwin") {
    return readDarwinMemory();
  }
  const totalBytes = os.totalmem();
  const availableBytes = os.freemem();
  return {
    totalBytes,
    usedBytes: totalBytes - availableBytes,
    availableBytes,
    freeBytes: availableBytes,
    cacheBytes: 0,
    anonymousBytes: 0,
    swapTotalBytes: 0,
    swapUsedBytes: 0,
  };
}

export async function readDisk(): Promise<VitalsSnapshot["disk"]> {
  try {
    const stats = await fs.statfs("/");
    const totalBytes = stats.blocks * stats.bsize;
    const availableBytes = stats.bavail * stats.bsize;
    const usedBytes = Math.max(0, totalBytes - stats.bfree * stats.bsize);
    return {
      path: "/",
      totalBytes,
      usedBytes,
      availableBytes,
      // Like df: blocks reserved for root count as neither used nor available.
      usedPercent: percent(diskPercent({ usedBytes, availableBytes })),
    };
  } catch {
    return { path: "/", totalBytes: 0, usedBytes: 0, availableBytes: 0, usedPercent: 0 };
  }
}

interface DockerStat {
  ID?: string;
  Name?: string;
  CPUPerc?: string;
  MemUsage?: string;
  MemPerc?: string;
  PIDs?: string;
  NetIO?: string;
  BlockIO?: string;
}

interface DockerPs {
  ID?: string;
  State?: string;
  Status?: string;
}

function parsePercent(value: string | undefined): number {
  const parsed = Number.parseFloat(value ?? "0");
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseJsonLines<T>(text: string): T[] {
  const values: T[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      values.push(JSON.parse(line) as T);
    } catch {
      // Ignore one malformed Docker row instead of losing the whole view.
    }
  }
  return values;
}

async function readDocker(): Promise<VitalsSnapshot["docker"]> {
  try {
    const options = { timeout: 4_000, maxBuffer: 4 * 1024 * 1024 };
    const [statsResult, psResult] = await Promise.all([
      execFileAsync("docker", ["stats", "--no-stream", "--all", "--format", "{{json .}}"], options),
      execFileAsync("docker", ["ps", "--all", "--format", "{{json .}}"], options),
    ]);
    const stats = parseJsonLines<DockerStat>(statsResult.stdout);
    const states = new Map(parseJsonLines<DockerPs>(psResult.stdout).map((row) => [row.ID ?? "", row]));
    const containers = stats.map((row) => {
      const state = states.get(row.ID ?? "");
      const usage = (row.MemUsage ?? "0B").split("/")[0]!.trim();
      return {
        id: row.ID ?? "unknown",
        name: row.Name ?? row.ID ?? "unknown",
        state: state?.State ?? "unknown",
        status: state?.Status ?? "Unknown",
        cpuPercent: parsePercent(row.CPUPerc),
        memoryBytes: parseByteSize(usage),
        memoryPercent: parsePercent(row.MemPerc),
        pids: Math.max(0, Number.parseInt(row.PIDs ?? "0", 10) || 0),
        netIO: row.NetIO ?? "—",
        blockIO: row.BlockIO ?? "—",
      };
    }).sort((a, b) => b.memoryBytes - a.memoryBytes);
    return {
      available: true,
      error: null,
      total: containers.length,
      running: containers.filter((container) => container.state.toLowerCase() === "running").length,
      cpuPercent: percent(containers.reduce((sum, container) => sum + container.cpuPercent, 0)),
      memoryBytes: containers.reduce((sum, container) => sum + container.memoryBytes, 0),
      containers,
    };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const message = code === "ENOENT"
      ? "Docker is not installed on this host."
      : code === "ETIMEDOUT"
        ? "Docker did not answer within 4 seconds."
        : "Docker is unavailable or access to its daemon was denied.";
    return {
      available: false,
      error: message,
      total: 0,
      running: 0,
      cpuPercent: 0,
      memoryBytes: 0,
      containers: [],
    };
  }
}

interface ProcessCollection {
  at: number;
  rows: ProcessRow[];
  byPid: Map<number, number>;
  hostCpu: number | null;
  daemonPid: number | null;
  paseoPids: Set<number>;
}

let processCache: ProcessCollection | null = null;
let processInflight: Promise<ProcessCollection> | null = null;

async function collectProcessesUncached(): Promise<ProcessCollection> {
  const rows = await readProcesses();
  const cpu = await cpuValues(rows);
  const daemonPid = findDaemonPid(rows);
  const paseoPids = descendantsOf(daemonPid, rows);
  await attachAgentIds(rows, paseoPids);
  return { at: Date.now(), rows, byPid: cpu.byPid, hostCpu: cpu.host, daemonPid, paseoPids };
}

/** All of /proc, read at most once per CACHE_MS however many views ask. */
function collectProcesses(): Promise<ProcessCollection> {
  if (processCache && Date.now() - processCache.at < CACHE_MS) return Promise.resolve(processCache);
  processInflight ??= collectProcessesUncached()
    .then((value) => (processCache = value))
    .finally(() => { processInflight = null; });
  return processInflight;
}

async function collectUncached(agents: PaseoAgent[]): Promise<VitalsSnapshot> {
  const warnings: string[] = [];
  const [processes, memory, disk, docker] = await Promise.all([
    collectProcesses(),
    readMemory(),
    readDisk(),
    readDocker(),
  ]);
  const { rows, daemonPid, paseoPids } = processes;
  const cpu = { host: processes.hostCpu, byPid: processes.byPid };

  if (process.platform !== "linux") warnings.push("Per-process and agent memory need a Linux host.");
  if (daemonPid === null && process.platform === "linux") warnings.push("The Paseo daemon process could not be identified.");

  const paseoRows = rows.filter((row) => paseoPids.has(row.pid));
  const coreRows = paseoRows.filter((row) => row.agentId === null);
  const agentRows = paseoRows.filter((row) => row.agentId !== null);
  const agentMeta = new Map(agents.map((agent) => [agent.id, agent]));
  const grouped = new Map<string, ProcessRow[]>();
  for (const row of agentRows) {
    const id = row.agentId!;
    const group = grouped.get(id) ?? [];
    group.push(row);
    grouped.set(id, group);
  }
  const agentUsage = [...grouped.entries()].map(([id, group]) => {
    const agent = agentMeta.get(id);
    return {
      id,
      title: agent?.title ?? null,
      workspaceId: agent?.workspaceId ?? null,
      provider: agent?.provider ?? "unknown",
      status: agent?.status ?? "running",
      rssBytes: group.reduce((sum, row) => sum + row.rssBytes, 0),
      cpuPercent: sumCpu(group, cpu.byPid),
      processCount: group.length,
    };
  }).sort((a, b) => b.rssBytes - a.rssBytes);

  const cpuInfo = os.cpus();
  const daemonRssBytes = daemonPid === null ? 0 : (rows.find((row) => row.pid === daemonPid)?.rssBytes ?? 0);
  const coreRssBytes = coreRows.reduce((sum, row) => sum + row.rssBytes, 0);
  const agentsRssBytes = agentUsage.reduce((sum, agent) => sum + agent.rssBytes, 0);
  return {
    capturedAt: new Date().toISOString(),
    host: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      cpuModel: cpuInfo[0]?.model.trim() ?? "Unknown CPU",
      logicalCores: Math.max(1, cpuInfo.length),
      cpuUsagePercent: cpu.host,
      loadAverage: os.loadavg(),
      uptimeSeconds: os.uptime(),
    },
    memory,
    disk,
    paseo: {
      daemonPid,
      daemonRssBytes,
      coreRssBytes,
      agentsRssBytes,
      totalRssBytes: coreRssBytes + agentsRssBytes,
      processCount: paseoRows.length,
      agents: agentUsage,
    },
    docker,
    largestProcesses: [...rows]
      .sort((a, b) => b.rssBytes - a.rssBytes)
      .slice(0, 8)
      .map((row) => ({
        pid: row.pid,
        name: row.name,
        rssBytes: row.rssBytes,
        cpuPercent: cpu.byPid.get(row.pid) ?? null,
      })),
    warnings,
  };
}

let cached: { at: number; value: VitalsSnapshot } | null = null;
let inflight: Promise<VitalsSnapshot> | null = null;

export async function collectVitals(agents: PaseoAgent[]): Promise<VitalsSnapshot> {
  const staged = fixture();
  if (staged) return staged.snapshot(agents);
  const now = Date.now();
  if (cached && now - cached.at < CACHE_MS) return cached.value;
  if (inflight) return inflight;
  inflight = collectUncached(agents)
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export const AGENT_PROCESS_LIMIT = 40;

/**
 * Orders one agent's processes as a tree (parents before children, siblings by memory) and caps
 * the list. Roots are processes whose parent is not in the group.
 */
export function treeOf(group: readonly { pid: number; ppid: number; name: string; rssBytes: number; cpuPercent: number | null }[], limit = AGENT_PROCESS_LIMIT): { processes: AgentProcess[]; hiddenCount: number } {
  const pids = new Set(group.map((row) => row.pid));
  const children = new Map<number, typeof group[number][]>();
  const roots: typeof group[number][] = [];
  for (const row of group) {
    if (pids.has(row.ppid) && row.ppid !== row.pid) {
      const list = children.get(row.ppid) ?? [];
      list.push(row);
      children.set(row.ppid, list);
    } else roots.push(row);
  }
  const bySize = (a: { rssBytes: number }, b: { rssBytes: number }) => b.rssBytes - a.rssBytes;
  const ordered: AgentProcess[] = [];
  const seen = new Set<number>();
  const visit = (row: typeof group[number], depth: number) => {
    if (seen.has(row.pid)) return;
    seen.add(row.pid);
    ordered.push({ pid: row.pid, name: row.name, depth, rssBytes: row.rssBytes, cpuPercent: row.cpuPercent });
    for (const child of [...(children.get(row.pid) ?? [])].sort(bySize)) visit(child, depth + 1);
  };
  for (const root of [...roots].sort(bySize)) visit(root, 0);
  return { processes: ordered.slice(0, limit), hiddenCount: Math.max(0, ordered.length - limit) };
}

/** One agent's process tree from the shared /proc collection; never starts Docker. */
export async function collectAgentTree(agentId: string): Promise<AgentTree> {
  const staged = fixture();
  if (staged) return staged.agentTree(agentId);
  const [processes, memory] = await Promise.all([collectProcesses(), readMemory()]);
  const group = processes.rows.filter((row) => row.agentId === agentId && processes.paseoPids.has(row.pid));
  const rssBytes = group.reduce((sum, row) => sum + row.rssBytes, 0);
  const tree = treeOf(group.map((row) => ({ ...row, cpuPercent: processes.byPid.get(row.pid) ?? null })));
  const warnings: string[] = [];
  if (process.platform !== "linux") warnings.push("Per-process detail needs a Linux host.");
  return {
    capturedAt: new Date().toISOString(),
    agentId,
    rssBytes,
    cpuPercent: sumCpu(group, processes.byPid),
    processCount: group.length,
    shareOfUsedPercent: share(rssBytes, memory.usedBytes),
    ...tree,
    warnings,
  };
}
