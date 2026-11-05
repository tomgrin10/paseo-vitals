import { Text, View } from "react-native";

import { formatBytes, formatDuration, formatPercent } from "../shared/format";
import { diskPercent, levelOf, roundPercent, share, type Level, type Resource } from "../shared/pressure";
import type { VitalsPulse } from "../shared/vitals";
import { History, Meter, levelText, type HistoryPoint } from "./charts";
import { text } from "./kit";
import { tabular, type Theme } from "./theme";

export interface Reading {
  key: Resource;
  label: string;
  /** "8 cores · load 2.60" */
  detail: string;
  percent: number | null;
  level: Level;
  /** Null for disk, which has no history. */
  history: HistoryPoint[] | null;
}

function points(pulse: VitalsPulse, resource: Resource, pick: (sample: VitalsPulse["history"][number]) => number | null): HistoryPoint[] {
  return pulse.history.map((sample) => {
    const value = pick(sample);
    return { at: sample.at, value, level: levelOf(resource, value) };
  });
}

/** The four instrument lines, in the same order everywhere. Swap is left out on hosts without it. */
export function readingsOf(pulse: VitalsPulse): Reading[] {
  const ram = share(pulse.memory.usedBytes, pulse.memory.totalBytes);
  const disk = diskPercent(pulse.disk);
  const readings: Reading[] = [
    {
      key: "cpu",
      label: "CPU",
      detail: `${pulse.logicalCores} cores · load ${pulse.loadAverage[0]!.toFixed(2)}`,
      percent: pulse.cpuPercent,
      level: levelOf("cpu", pulse.cpuPercent),
      history: points(pulse, "cpu", (sample) => sample.cpuPercent),
    },
    {
      key: "ram",
      label: "RAM",
      detail: `${formatBytes(pulse.memory.usedBytes)} of ${formatBytes(pulse.memory.totalBytes)} · ${formatBytes(pulse.memory.availableBytes)} free`,
      percent: ram,
      level: levelOf("ram", ram),
      history: points(pulse, "ram", (sample) => sample.memoryPercent),
    },
  ];
  if (pulse.memory.swapTotalBytes > 0) {
    const swap = share(pulse.memory.swapUsedBytes, pulse.memory.swapTotalBytes);
    readings.push({
      key: "swap",
      label: "Swap",
      detail: `${formatBytes(pulse.memory.swapUsedBytes)} of ${formatBytes(pulse.memory.swapTotalBytes)}`,
      percent: swap,
      // Swap colours only when it adds to real pressure; a full swap with free RAM is normal on Linux.
      level: ram >= 85 ? levelOf("swap", swap) : "ok",
      history: points(pulse, "swap", (sample) => sample.swapPercent),
    });
  }
  readings.push({
    key: "disk",
    label: "Disk",
    detail: `${formatBytes(pulse.disk.usedBytes)} of ${formatBytes(pulse.disk.usedBytes + pulse.disk.availableBytes)} · ${formatBytes(pulse.disk.availableBytes)} free`,
    percent: disk,
    level: levelOf("disk", disk),
    history: null,
  });
  return readings;
}

export function hostLine(pulse: VitalsPulse): string {
  return `up ${formatDuration(pulse.uptimeSeconds)} · load ${pulse.loadAverage.map((n) => n.toFixed(2)).join(" ")}`;
}

/**
 * One instrument line. `wide` puts label, trace and value on one row (the dashboard at desktop
 * width); otherwise label and value share the top line and the trace sits under them.
 */
export function Instrument({ theme, reading, wide, chartHeight }: { theme: Theme; reading: Reading; wide: boolean; chartHeight?: number }) {
  const c = theme.colors;
  const t = text(c);
  const value = (
    <Text style={{ ...t.title, fontSize: wide ? 17 : 13, lineHeight: wide ? 22 : 18, color: levelText(c, reading.level), textAlign: "right", minWidth: wide ? 64 : 0, ...tabular }}>
      {reading.key === "cpu" ? formatPercent(reading.percent) : reading.percent === null ? "–" : roundPercent(reading.percent)}
    </Text>
  );
  const chart = reading.history
    ? <History theme={theme} points={reading.history} height={chartHeight ?? (wide ? 30 : 22)} label={`${reading.label} over the last five minutes`} format={(v) => formatPercent(v)} />
    : <View style={{ height: chartHeight ?? (wide ? 30 : 22), justifyContent: "flex-end", paddingBottom: wide ? 4 : 2 }}>
        <Meter theme={theme} percent={reading.percent ?? 0} level={reading.level} label={`${reading.label} used`} />
      </View>;
  if (wide) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 20 }}>
        <View style={{ width: 230, gap: 1 }}>
          <Text style={t.label}>{reading.label}</Text>
          <Text numberOfLines={1} style={t.meta}>{reading.detail}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>{chart}</View>
        {value}
      </View>
    );
  }
  return (
    <View style={{ gap: 3 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
        <Text style={t.label}>{reading.label}</Text>
        <Text numberOfLines={1} style={[t.meta, { flex: 1, minWidth: 0 }]}>{reading.detail}</Text>
        {value}
      </View>
      {chart}
    </View>
  );
}
