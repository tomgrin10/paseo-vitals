import { useState } from "react";
import { Platform, Text, View } from "react-native";

import type { Composition, SegmentKey } from "../shared/composition";
import { formatBytes } from "../shared/format";
import type { Level } from "../shared/pressure";
import { isLight, tabular, withAlpha, type Colors, type Theme } from "./theme";

/**
 * Charts drawn with Views (plugins get no SVG library). One colour rule, from the dataviz method
 * and the rest of the family: magnitude and identity are foreground ink at stepped strengths, so
 * a chart reads the same in light and dark; amber and red mean state and appear only past a
 * threshold.
 */

export function ink(colors: Colors, strength: number): string {
  return withAlpha(colors.foreground, Math.min(1, strength * (isLight(colors) ? 1.1 : 1)));
}

export function levelColor(colors: Colors, level: Level, strength = 0.78): string {
  return level === "critical" ? colors.statusDanger : level === "warning" ? colors.statusWarning : ink(colors, strength);
}

/** Text colour for a value: ink when fine, the state hue otherwise. */
export function levelText(colors: Colors, level: Level): string {
  return level === "critical" ? colors.statusDanger : level === "warning" ? colors.statusWarning : colors.foreground;
}

const hoverable = Platform.OS === "web";

/** A horizontal meter: track plus the used share; a sliver stays visible above zero. */
export function Meter({ theme, percent, level = "ok", height = 6, label }: {
  theme: Theme; percent: number; level?: Level; height?: number; label: string;
}) {
  const c = theme.colors;
  const used = Math.max(0, Math.min(100, percent));
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(used) }}
      style={{ height, borderRadius: height / 2, backgroundColor: ink(c, 0.1), overflow: "hidden" }}
    >
      <View style={{ width: `${used}%`, minWidth: used > 0 ? 2 : 0, height, borderRadius: height / 2, backgroundColor: levelColor(c, level) }} />
    </View>
  );
}

export interface HistoryPoint {
  at: number;
  value: number | null;
  level: Level;
}

/**
 * The last few minutes as thin columns, oldest left, padded to `slots` so a young history grows in
 * from the right instead of stretching. On the web a hovered column shows its time and value.
 */
export function History({ theme, points, slots = 60, height = 28, label, format }: {
  theme: Theme; points: readonly HistoryPoint[]; slots?: number; height?: number; label: string; format: (value: number) => string;
}) {
  const c = theme.colors;
  const [hovered, setHovered] = useState<number | null>(null);
  const shown = points.slice(-slots);
  const pad = slots - shown.length;
  const focus = hovered === null ? null : shown[hovered - pad] ?? null;
  return (
    <View accessible accessibilityLabel={label} style={{ height, flexDirection: "row", alignItems: "flex-end", gap: 1 }}>
      {Array.from({ length: slots }, (_, index) => {
        const point = index >= pad ? shown[index - pad] : undefined;
        const value = point?.value ?? null;
        const last = index === slots - 1;
        const fill = point && value !== null
          ? point.level === "ok" ? ink(c, hovered === index || last ? 0.72 : 0.32) : levelColor(c, point.level)
          : ink(c, 0.08);
        const h = value === null ? 1 : Math.max(1.5, (Math.min(100, value) / 100) * height);
        return (
          <View
            key={index}
            {...(hoverable && point ? { onPointerEnter: () => setHovered(index), onPointerLeave: () => setHovered(null) } : {})}
            style={{ flex: 1, height: "100%", justifyContent: "flex-end" }}
          >
            {/* A faint full-height column behind each bar keeps the trace's box visible, so low
                readings sit in a chart under their label instead of floating between rows. */}
            <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: ink(c, 0.045) }} />
            <View style={{ height: h, borderTopLeftRadius: 1, borderTopRightRadius: 1, backgroundColor: fill }} />
          </View>
        );
      })}
      {focus && focus.value !== null ? (
        <View pointerEvents="none" style={{ position: "absolute", top: -2, left: 0, paddingHorizontal: 5, borderRadius: 4, backgroundColor: c.surface2 }}>
          <Text style={{ color: c.foreground, fontSize: 11, lineHeight: 16, ...tabular }}>
            {new Date(focus.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })} · {format(focus.value)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/** Strongest ink for agents (the plugin's subject), then Paseo, Docker, everything else. */
const SEGMENT_STRENGTH: Record<SegmentKey, number> = { agents: 0.82, paseo: 0.52, docker: 0.32, other: 0.2 };

export function segmentColor(colors: Colors, key: SegmentKey): string {
  return ink(colors, SEGMENT_STRENGTH[key]);
}

/** RAM in use split into its parts, on a track as wide as all RAM, with 2px gaps between parts. */
export function CompositionBar({ theme, composition, height = 14 }: {
  theme: Theme; composition: Composition; height?: number;
}) {
  const c = theme.colors;
  const total = Math.max(1, composition.totalBytes);
  const parts = composition.segments.filter((segment) => segment.bytes > 0);
  return (
    <View
      accessible
      accessibilityLabel={`RAM in use: ${parts.map((part) => `${part.label} ${formatBytes(part.bytes)}`).join(", ")}, of ${formatBytes(composition.totalBytes)}`}
      style={{ height, flexDirection: "row", borderRadius: 4, overflow: "hidden", backgroundColor: ink(c, 0.06), gap: 2 }}
    >
      {parts.map((part) => (
        <View key={part.key} style={{ width: `${(part.bytes / total) * 100}%`, minWidth: 2, backgroundColor: segmentColor(c, part.key) }} />
      ))}
    </View>
  );
}

/** A thin magnitude bar for ranked rows, relative to the largest row. */
export function InkBar({ theme, fraction, width = 72 }: { theme: Theme; fraction: number; width?: number | `${number}%` }) {
  const c = theme.colors;
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <View style={{ width, height: 4, borderRadius: 2, backgroundColor: ink(c, 0.08), overflow: "hidden" }}>
      <View style={{ width: `${f * 100}%`, minWidth: f > 0 ? 2 : 0, height: 4, borderRadius: 2, backgroundColor: ink(c, 0.6) }} />
    </View>
  );
}

export function Swatch({ color, size = 9 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: 2, backgroundColor: color }} />;
}
