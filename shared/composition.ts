import type { VitalsSnapshot } from "./vitals.ts";

export type SegmentKey = "agents" | "paseo" | "docker" | "other";

export interface Segment {
  key: SegmentKey;
  label: string;
  bytes: number;
}

export interface Composition {
  usedBytes: number;
  totalBytes: number;
  segments: Segment[];
  /**
   * RSS counts shared pages in every process that maps them, so the attributed parts can add up
   * to more than RAM in use. They are then scaled down to fit and this is true.
   */
  scaled: boolean;
}

/**
 * Where the RAM in use went: agent process trees, the rest of Paseo (daemon and plugins), Docker
 * containers, and everything else. Reclaimable cache is not "used" and is left out.
 */
export function compositionOf(snapshot: Pick<VitalsSnapshot, "memory" | "paseo" | "docker">): Composition {
  const usedBytes = Math.max(0, snapshot.memory.usedBytes);
  const parts: Segment[] = [
    { key: "agents", label: "Agents", bytes: Math.max(0, snapshot.paseo.agentsRssBytes) },
    { key: "paseo", label: "Paseo", bytes: Math.max(0, snapshot.paseo.coreRssBytes) },
    { key: "docker", label: "Docker", bytes: snapshot.docker.available ? Math.max(0, snapshot.docker.memoryBytes) : 0 },
  ];
  const attributed = parts.reduce((sum, part) => sum + part.bytes, 0);
  const scaled = attributed > usedBytes && attributed > 0;
  const factor = scaled ? usedBytes / attributed : 1;
  const segments = parts.map((part) => ({ ...part, bytes: Math.round(part.bytes * factor) }));
  const other = Math.max(0, usedBytes - segments.reduce((sum, part) => sum + part.bytes, 0));
  segments.push({ key: "other", label: "Everything else", bytes: other });
  return { usedBytes, totalBytes: snapshot.memory.totalBytes, segments, scaled };
}
