import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { VitalsSnapshot } from "../shared/vitals.ts";

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
let cached: { at: number; value: VitalsSnapshot } | null = null;
let inflight: Promise<VitalsSnapshot> | null = null;

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

// ps reports cumulative CPU time as [[dd-]hh:]mm:ss[.cc]; convert it to the same ticks as /proc.
export function parseCpuTime(value: string): number {
  const match = value.trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return 0;
  const [, days = "0", hours = "0", minutes, seconds] = match;
  const total = Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
  return Math.round(total * CLOCK_TICKS);
}

export function parsePsProcesses(text: string): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of text.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    rows.push({
      pid,
      ppid: Number(match[2]),
      name: path.basename(match[5]!.trim()).slice(0, 80) || `pid ${pid}`,
      rssBytes: Number(match[3]) * 1024,
      cpuTicks: parseCpuTime(match[4]!),
      agentId: null,
    });
  }
  return rows;
}

async function readProcesses(): Promise<ProcessRow[]> {
  if (process.platform === "darwin") {
    try {
      const { stdout } = await execFileAsync("ps", ["-axww", "-o", "pid=,ppid=,rss=,time=,comm="], {
        timeout: 4_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      return parsePsProcesses(stdout);
    } catch {
      // Keep memory, disk, and Docker. The missing daemon warning reports the process gap.
      return [];
    }
  }
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
  const named = rows.find((row) => row.name === "Paseo Daemon");
  if (named) return named.pid;
  // The daemon spawns each plugin process directly, so its parent is the daemon.
  return byPid.has(process.ppid) ? process.ppid : null;
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

// `ps -E` appends the environment to the command line. Keep only the agent ID.
export function parsePsAgentIds(text: string): Map<number, string> {
  const ids = new Map<number, string>();
  for (const line of text.split("\n")) {
    const pid = line.trim().match(/^(\d+)\s/);
    const id = line.match(/(?:^|\s)PASEO_AGENT_ID=(\S+)/);
    if (pid && id) ids.set(Number(pid[1]), id[1]!);
  }
  return ids;
}

async function attachAgentIds(rows: ProcessRow[], paseoPids: Set<number>): Promise<void> {
  if (process.platform === "darwin") {
    if (paseoPids.size > 0) {
      // ps exits non-zero when a listed process has already exited, but still prints the others.
      const stdout = await execFileAsync("ps", ["-Eww", "-o", "pid=,command=", "-p", [...paseoPids].join(",")], {
        timeout: 4_000,
        maxBuffer: 16 * 1024 * 1024,
      }).then((result) => result.stdout, (error: { stdout?: string }) => error.stdout ?? "");
      const ids = parsePsAgentIds(stdout);
      for (const row of rows) row.agentId = ids.get(row.pid) ?? null;
    }
  } else {
    await Promise.all(rows.filter((row) => paseoPids.has(row.pid)).map(async (row) => {
      try {
        row.agentId = readAgentId(await fs.readFile(`/proc/${row.pid}/environ`));
      } catch {
        // A short-lived process may disappear between /proc reads.
      }
    }));
  }

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

function readSystemCpu(): { totalTicks: number; idleTicks: number } {
  const cpus = os.cpus();
  let totalTicks = 0;
  let idleTicks = 0;
  for (const cpu of cpus) {
    idleTicks += cpu.times.idle;
    totalTicks += Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
  }
  return { totalTicks, idleTicks };
}

function percent(value: number): number {
  return Math.max(0, Math.round(value * 10) / 10);
}

function cpuValues(rows: ProcessRow[]) {
  const now = Date.now();
  const system = readSystemCpu();
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

// Mirrors Activity Monitor: used = app + wired + compressed; cached files are reclaimable.
export function parseVmStat(text: string, totalBytes: number, swapUsage: string) {
  const pageBytes = Number(text.match(/page size of (\d+) bytes/)?.[1] ?? 4096);
  const pages = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = line.match(/^"?([^:"]+)"?:\s+(\d+)\.?$/);
    if (match) pages.set(match[1]!.trim(), Number(match[2]) * pageBytes);
  }
  const get = (key: string) => pages.get(key) ?? 0;
  const appBytes = Math.max(0, get("Anonymous pages") - get("Pages purgeable"));
  const usedBytes = Math.min(totalBytes, appBytes + get("Pages wired down") + get("Pages occupied by compressor"));
  // sysctl prints sizes such as "2048.00M".
  const swapBytes = (key: string) => parseByteSize(`${swapUsage.match(new RegExp(`${key} = (\\S+)`))?.[1] ?? "0"}B`);
  const swapTotalBytes = swapBytes("total");
  const swapUsedBytes = swapBytes("used");
  return {
    totalBytes,
    usedBytes,
    availableBytes: totalBytes - usedBytes,
    freeBytes: get("Pages free"),
    cacheBytes: get("File-backed pages") + get("Pages purgeable"),
    anonymousBytes: appBytes,
    swapTotalBytes,
    swapUsedBytes,
  };
}

async function readMemory() {
  if (process.platform === "linux") {
    return parseMeminfo(await fs.readFile("/proc/meminfo", "utf8"));
  }
  if (process.platform === "darwin") {
    try {
      const options = { timeout: 4_000 };
      const [vmStat, swap] = await Promise.all([
        execFileAsync("vm_stat", [], options),
        execFileAsync("sysctl", ["-n", "vm.swapusage"], options).catch(() => ({ stdout: "" })),
      ]);
      return parseVmStat(vmStat.stdout, os.totalmem(), swap.stdout);
    } catch {
      // Fall through to Node's free-page count.
    }
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

async function readDisk(): Promise<VitalsSnapshot["disk"]> {
  // macOS mounts a small sealed system volume at "/"; user data lives on the Data volume.
  const darwin = process.platform === "darwin";
  const diskPath = darwin ? "/System/Volumes/Data" : "/";
  try {
    const stats = await fs.statfs(diskPath);
    const totalBytes = stats.blocks * stats.bsize;
    const availableBytes = stats.bavail * stats.bsize;
    // APFS volumes share one container, so count space used by every volume in it.
    const usedBytes = Math.max(0, totalBytes - (darwin ? stats.bavail : stats.bfree) * stats.bsize);
    return {
      path: diskPath,
      totalBytes,
      usedBytes,
      availableBytes,
      usedPercent: totalBytes > 0 ? percent(usedBytes / totalBytes * 100) : 0,
    };
  } catch {
    return { path: diskPath, totalBytes: 0, usedBytes: 0, availableBytes: 0, usedPercent: 0 };
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

// Apps opened from the macOS Dock get a minimal PATH that misses Docker Desktop's CLI.
function dockerEnv(): NodeJS.ProcessEnv {
  if (process.platform !== "darwin") return process.env;
  const dirs = [process.env.PATH, "/usr/local/bin", "/opt/homebrew/bin", path.join(os.homedir(), ".docker", "bin")];
  return { ...process.env, PATH: dirs.filter(Boolean).join(":") };
}

async function readDocker(): Promise<VitalsSnapshot["docker"]> {
  try {
    const options = { timeout: 4_000, maxBuffer: 4 * 1024 * 1024, env: dockerEnv() };
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

async function collectUncached(agents: PaseoAgent[]): Promise<VitalsSnapshot> {
  const warnings: string[] = [];
  const [rows, memory, disk, docker] = await Promise.all([
    readProcesses(),
    readMemory(),
    readDisk(),
    readDocker(),
  ]);
  const cpu = cpuValues(rows);
  const daemonPid = findDaemonPid(rows);
  const paseoPids = descendantsOf(daemonPid, rows);
  await attachAgentIds(rows, paseoPids);

  if (process.platform !== "linux" && process.platform !== "darwin") {
    warnings.push("Per-process and agent memory require a Linux or macOS host.");
  }
  if (daemonPid === null) warnings.push("The Paseo daemon process could not be identified.");

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

export async function collectVitals(agents: PaseoAgent[]): Promise<VitalsSnapshot> {
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
