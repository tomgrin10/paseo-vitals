import os from "node:os";

import { share } from "../shared/pressure.ts";
import type { PulseSample, VitalsPulse } from "../shared/vitals.ts";
import { percent, readDisk, readMemory, readSystemCpu } from "./collect.ts";
import { fixture } from "./fixture.ts";

export const PULSE_INTERVAL_MS = 5_000;
export const PULSE_HISTORY = 60;
/** Nobody has asked for this long: stop sampling and forget the history. */
export const PULSE_IDLE_MS = 60_000;
/** Disk usage moves slowly; no need to ask the kernel every five seconds. */
const DISK_INTERVAL_MS = 30_000;

type Memory = Awaited<ReturnType<typeof readMemory>>;
type Disk = Awaited<ReturnType<typeof readDisk>>;

export interface PulseClock {
  now(): number;
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

const systemClock: PulseClock = {
  now: () => Date.now(),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

export interface PulseSource {
  cpu(): Promise<{ totalTicks: number; idleTicks: number }>;
  memory(): Promise<Memory>;
  disk(): Promise<Disk>;
}

const systemSource: PulseSource = { cpu: readSystemCpu, memory: readMemory, disk: readDisk };

/**
 * The light sampler behind the meters: two small /proc reads every five seconds, and only while
 * someone is reading. It starts on the first read and stops a minute after the last one, so a
 * closed app costs nothing.
 */
export function createPulse(source: PulseSource = systemSource, clock: PulseClock = systemClock) {
  let timer: unknown = null;
  let lastRead = 0;
  let history: PulseSample[] = [];
  let previousCpu: { totalTicks: number; idleTicks: number } | null = null;
  let memory: Memory | null = null;
  let disk: Disk | null = null;
  let diskAt = 0;
  let cpuPercent: number | null = null;
  let ticking: Promise<void> | null = null;

  const tick = async () => {
    const now = clock.now();
    if (now - lastRead > PULSE_IDLE_MS) return stop();
    const [cpu, nextMemory] = await Promise.all([source.cpu(), source.memory()]);
    if (!disk || now - diskAt >= DISK_INTERVAL_MS) {
      disk = await source.disk();
      diskAt = now;
    }
    memory = nextMemory;
    if (previousCpu) {
      const total = cpu.totalTicks - previousCpu.totalTicks;
      const idle = cpu.idleTicks - previousCpu.idleTicks;
      cpuPercent = total > 0 ? percent((1 - idle / total) * 100) : cpuPercent;
    }
    previousCpu = cpu;
    history.push({
      at: now,
      cpuPercent,
      memoryPercent: share(memory.usedBytes, memory.totalBytes),
      swapPercent: share(memory.swapUsedBytes, memory.swapTotalBytes),
    });
    if (history.length > PULSE_HISTORY) history = history.slice(-PULSE_HISTORY);
  };

  const step = () => {
    ticking ??= tick().catch(() => undefined).finally(() => { ticking = null; });
    return ticking;
  };

  function stop() {
    if (timer !== null) clock.clearInterval(timer);
    timer = null;
    history = [];
    previousCpu = null;
    cpuPercent = null;
  }

  return {
    get running() { return timer !== null; },
    async read(): Promise<VitalsPulse> {
      const staged = fixture();
      if (staged) return staged.pulse();
      lastRead = clock.now();
      if (timer === null) {
        timer = clock.setInterval(() => void step(), PULSE_INTERVAL_MS);
        await step();
      } else if (ticking) await ticking;
      const m = memory ?? await source.memory();
      const d = disk ?? await source.disk();
      const [one = 0, five = 0, fifteen = 0] = os.loadavg();
      return {
        capturedAt: new Date(history.at(-1)?.at ?? clock.now()).toISOString(),
        hostname: os.hostname(),
        uptimeSeconds: os.uptime(),
        logicalCores: Math.max(1, os.cpus().length),
        loadAverage: [one, five, fifteen],
        cpuPercent,
        memory: {
          totalBytes: m.totalBytes,
          usedBytes: m.usedBytes,
          availableBytes: m.availableBytes,
          swapTotalBytes: m.swapTotalBytes,
          swapUsedBytes: m.swapUsedBytes,
        },
        disk: d,
        intervalMs: PULSE_INTERVAL_MS,
        history: [...history],
      };
    },
    stop,
  };
}
