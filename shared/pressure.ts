/**
 * When the machine is short of something. One rule for every surface: the meters colour by
 * `levelOf`, and the composer pill and the dashboard sentence read `pressureOf`.
 *
 * CPU never raises pressure: a busy CPU slows agents down, a full RAM or disk kills them.
 */

export type Level = "ok" | "warning" | "critical";
export type Resource = "cpu" | "ram" | "swap" | "disk";

export const THRESHOLDS: Record<Resource, { warning: number; critical: number }> = {
  cpu: { warning: 90, critical: Number.POSITIVE_INFINITY },
  ram: { warning: 90, critical: 95 },
  // Linux keeps cold pages in swap for days; only nearly full swap matters, and only with RAM tight.
  swap: { warning: 80, critical: 95 },
  disk: { warning: 90, critical: 95 },
};

export function levelOf(resource: Resource, percent: number | null): Level {
  if (percent === null || !Number.isFinite(percent)) return "ok";
  // Judge the number people see: a displayed "95%" is critical everywhere, never amber in one place.
  percent = shownPercent(percent);
  const t = THRESHOLDS[resource];
  if (percent >= t.critical) return "critical";
  if (percent >= t.warning) return "warning";
  return "ok";
}

export function share(used: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
}

/** Like df: the share of the space a user can fill, so 100% really means no room left. */
export function diskPercent(disk: { usedBytes: number; availableBytes: number }): number {
  return share(disk.usedBytes, disk.usedBytes + disk.availableBytes);
}

export interface PressureInput {
  memory: { totalBytes: number; usedBytes: number; swapTotalBytes: number; swapUsedBytes: number };
  disk: { usedBytes: number; availableBytes: number };
}

export interface PressureItem {
  resource: "ram" | "swap" | "disk";
  percent: number;
  level: Exclude<Level, "ok">;
}

export interface Pressure {
  level: Level;
  /** Worst first. Empty when the machine is fine. */
  items: PressureItem[];
}

const rank: Record<Level, number> = { ok: 0, warning: 1, critical: 2 };

export function pressureOf(input: PressureInput): Pressure {
  const ram = share(input.memory.usedBytes, input.memory.totalBytes);
  const swap = share(input.memory.swapUsedBytes, input.memory.swapTotalBytes);
  const disk = diskPercent(input.disk);
  const items: PressureItem[] = [];
  const add = (resource: PressureItem["resource"], percent: number, level: Level) => {
    if (level !== "ok") items.push({ resource, percent, level });
  };
  add("ram", ram, levelOf("ram", ram));
  // Swap filling up only matters while RAM is also nearly gone.
  if (input.memory.swapTotalBytes > 0 && ram >= THRESHOLDS.ram.warning - 5) add("swap", swap, levelOf("swap", swap));
  add("disk", disk, levelOf("disk", disk));
  items.sort((a, b) => rank[b.level] - rank[a.level] || b.percent - a.percent);
  return { level: items[0]?.level ?? "ok", items };
}

const NAMES = { ram: "RAM", swap: "Swap", disk: "Disk" } as const;

/** Whole percent, the way every surface shows it; 99.6% stays 99% so "100%" always means full. */
export function shownPercent(percent: number): number {
  return percent >= 100 ? 100 : Math.min(99, Math.round(percent));
}

export function roundPercent(percent: number): string {
  return `${shownPercent(percent)}%`;
}

/** The pill's label: "RAM 94%", or "RAM 94% · Disk 91%". */
export function pressureLabel(pressure: Pressure): string {
  return pressure.items.slice(0, 2).map((item) => `${NAMES[item.resource]} ${roundPercent(item.percent)}`).join(" · ");
}

/** One plain sentence for the dashboard header and the pill's sheet title. */
export function pressureHeadline(pressure: Pressure): string {
  if (pressure.level === "ok") return "Running fine";
  const names = [...new Set(pressure.items.map((item) => item.resource === "swap" ? "ram" : item.resource))];
  // "RAM and disk", "Disk and RAM": a name inside the sentence is a common noun, except RAM.
  const subject = names.map((name, index) => index === 0 || name === "ram" ? NAMES[name] : NAMES[name].toLowerCase()).join(" and ");
  const plural = names.length > 1;
  if (pressure.level === "critical") return `${subject} ${plural ? "are" : "is"} almost out`;
  return `${subject} ${plural ? "are" : "is"} running low`;
}
