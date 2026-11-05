import type { PluginPopoverProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent, type PressableStateCallbackType } from "react-native";

import { formatDuration, formatPercent } from "../shared/format";
import { pressureHeadline, roundPercent } from "../shared/pressure";
import { Meter, levelText } from "./charts";
import { Instrument, readingsOf } from "./instruments";
import { Button, text } from "./kit";
import { useLive, type Live } from "./live";
import { tabular } from "./theme";

const ICON = 14;
const FONT = 12;
/** Below this width the meters go and only the numbers stay; below the next, disk goes too. */
const METERS_FROM = 236;
const DISK_FROM = 150;

const ICONS = { cpu: "Cpu", ram: "MemoryStick", swap: "ArrowDownUp", disk: "HardDrive" } as const;

/**
 * Sidebar footer: CPU, RAM and disk as tiny meters with fixed-width numbers (changing digits
 * never shift the line), coloured only past a threshold. Opens the history popover.
 */
export function footerItem(live: Live) {
  function HistoryPopover({ theme, layout, close, openScreen }: PluginPopoverProps) {
    useLive(live);
    const c = theme.colors;
    const t = text(c);
    const pulse = live.pulse();
    const pressure = live.pressure();
    return (
      // On phones the sheet is the surface: no second card inside it.
      <View style={layout.compact ? { paddingHorizontal: 4, gap: 18 } : { width: 320, padding: 14, gap: 18, backgroundColor: c.surface1 }}>
        {pulse ? (
          <>
            <View style={{ gap: 2 }}>
              <Text numberOfLines={1} style={t.title}>{pulse.hostname}</Text>
              <Text style={t.meta}>
                {pressure.level === "ok" ? null : <Text style={{ color: levelText(c, pressure.level), fontWeight: "600" }}>{pressureHeadline(pressure)} · </Text>}
                up {formatDuration(pulse.uptimeSeconds)}
              </Text>
            </View>
            {readingsOf(pulse).map((reading) => <Instrument key={reading.key} theme={theme} reading={reading} wide={false} />)}
            <Text style={t.small}>Last five minutes, every five seconds.</Text>
          </>
        ) : (
          <Text style={t.meta}>{live.error() ? `Can't read this host: ${live.error()}` : "Reading this host…"}</Text>
        )}
        <Button theme={theme} kind="secondary" icon="Gauge" title="Open Host vitals" compact={layout.compact} grow={layout.compact}
          onPress={() => { close(); openScreen({ screenId: "dashboard" }); }} />
      </View>
    );
  }

  return function VitalsFooter({ theme, openPopover }: PluginSidebarItemProps) {
    useLive(live);
    const [width, setWidth] = useState<number | null>(null);
    const c = theme.colors;
    const pulse = live.pulse();
    // Like Paseo's own usage summary: nothing until there is something to show.
    if (!pulse) return null;
    const readings = readingsOf(pulse).filter((reading) => reading.key !== "swap"
      && (reading.key !== "disk" || width === null || width >= DISK_FROM));
    const meters = width !== null && width >= METERS_FROM;
    const pressure = live.pressure();
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Host vitals: ${readings.map((r) => `${r.label} ${formatPercent(r.percent)}`).join(", ")}${pressure.level === "ok" ? "" : `. ${pressureHeadline(pressure)}`}`}
        onPress={() => openPopover(HistoryPopover)}
        style={(state: PressableStateCallbackType & { hovered?: boolean }) => ({
          width: "100%", minHeight: 28, paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8,
          backgroundColor: state.hovered || state.pressed ? c.surface2 : undefined,
        })}
      >
        <View onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {readings.map((reading) => (
            <View key={reading.key} style={{ flexDirection: "row", alignItems: "center", gap: 5, flexGrow: meters ? 1 : 0, flexShrink: 1, minWidth: 0 }}>
              <Icon name={ICONS[reading.key]} size={ICON} color={reading.level === "ok" ? c.foregroundMuted : levelText(c, reading.level)} />
              {meters ? <View style={{ flex: 1, minWidth: 14 }}><Meter theme={theme} percent={reading.percent ?? 0} level={reading.level} height={5} label={`${reading.label} used`} /></View> : null}
              <Text numberOfLines={1} style={{ width: 32, textAlign: "right", fontSize: FONT, lineHeight: 16, color: reading.level === "ok" ? c.foreground : levelText(c, reading.level), ...tabular }}>
                {reading.percent === null ? "–" : roundPercent(reading.percent)}
              </Text>
            </View>
          ))}
        </View>
      </Pressable>
    );
  };
}
