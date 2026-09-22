import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";

import { vitalsSnapshot, type VitalsSnapshot } from "../shared/vitals";

type Theme = PluginSurfaceProps["theme"];

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatPercent(value: number | null): string {
  return value === null ? "sampling…" : `${value.toFixed(value >= 10 ? 0 : 1)}%`;
}

function tone(theme: Theme, value: number): string {
  if (value >= 90) return theme.colors.statusDanger;
  if (value >= 70) return theme.colors.statusWarning;
  return theme.colors.accent;
}

function Bar({ theme, value }: { theme: Theme; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <View style={{ height: 5, borderRadius: 3, overflow: "hidden", backgroundColor: theme.colors.surface2 }}>
      <View style={{ width: `${clamped}%`, height: 5, backgroundColor: tone(theme, clamped) }} />
    </View>
  );
}

function Card({
  theme,
  label,
  value,
  detail,
  percent,
  compact,
}: {
  theme: Theme;
  label: string;
  value: string;
  detail: string;
  percent?: number;
  compact: boolean;
}) {
  return (
    <View
      style={{
        minWidth: compact ? "100%" : 175,
        flexGrow: 1,
        flexBasis: compact ? "100%" : 0,
        gap: 7,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" }}>
        {label}
      </Text>
      <Text style={{ color: theme.colors.foreground, fontSize: 21, fontWeight: "700", fontVariant: ["tabular-nums"] }}>
        {value}
      </Text>
      {percent !== undefined ? <Bar theme={theme} value={percent} /> : null}
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{detail}</Text>
    </View>
  );
}

function Section({ theme, title, note, children }: { theme: Theme; title: string; note?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 3 }}>
        <Text style={{ color: theme.colors.foreground, fontSize: 16, fontWeight: "700" }}>{title}</Text>
        {note ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{note}</Text> : null}
      </View>
      <View
        style={{
          borderRadius: 12,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
          overflow: "hidden",
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Divider({ theme }: { theme: Theme }) {
  return <View style={{ height: 1, backgroundColor: theme.colors.border }} />;
}

function MetricRow({
  theme,
  title,
  detail,
  value,
  onPress,
}: {
  theme: Theme;
  title: string;
  detail: string;
  value: string;
  onPress?: () => void;
}) {
  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 11 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontWeight: "600" }}>{title}</Text>
        <Text numberOfLines={1} style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{detail}</Text>
      </View>
      <Text style={{ color: theme.colors.foreground, fontVariant: ["tabular-nums"], fontWeight: "600" }}>{value}</Text>
      {onPress ? <Icon name="ChevronRight" size={16} color={theme.colors.foregroundMuted} /> : null}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open agent ${title}`} onPress={onPress}>
      {content}
    </Pressable>
  ) : content;
}

function MemoryDetail({ theme, data, compact }: { theme: Theme; data: VitalsSnapshot; compact: boolean }) {
  const values = [
    ["Available", data.memory.availableBytes],
    ["Cache + buffers", data.memory.cacheBytes],
    ["Anonymous", data.memory.anonymousBytes],
    ["Swap used", data.memory.swapUsedBytes],
  ] as const;
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", padding: 7 }}>
      {values.map(([label, value]) => (
        <View key={label} style={{ width: compact ? "50%" : "25%", gap: 3, padding: 7 }}>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>{label}</Text>
          <Text style={{ color: theme.colors.foreground, fontWeight: "600", fontVariant: ["tabular-nums"] }}>
            {formatBytes(value)}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function VitalsSurface({ theme, host, layout, navigation }: PluginSurfaceProps) {
  const readVitals = useRpc(vitalsSnapshot);
  const [showAllContainers, setShowAllContainers] = useState(false);
  const query = useQuery({
    queryKey: ["paseo-vitals", host.id],
    queryFn: () => readVitals({}),
    refetchInterval: 5_000,
    staleTime: 2_500,
  });

  const data = query.data;
  const padding = layout.compact ? 14 : 24;
  const memoryPercent = data ? data.memory.usedBytes / data.memory.totalBytes * 100 : 0;
  const visibleContainers = data?.docker.containers.slice(0, showAllContainers ? undefined : 8) ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.colors.surface0 }}
      contentContainerStyle={{ width: "100%", maxWidth: 1040, alignSelf: "center", padding, gap: 22 }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: theme.colors.foreground, fontSize: 21, fontWeight: "700" }}>
            {data?.host.hostname ?? host.label}
          </Text>
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
            {data
              ? `${data.host.platform} · ${data.host.arch} · up ${formatDuration(data.host.uptimeSeconds)}`
              : "Reading this Paseo host…"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh host vitals"
          disabled={query.isFetching}
          onPress={() => void query.refetch()}
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            alignItems: "center",
            justifyContent: "center",
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.surface1,
            opacity: query.isFetching ? 0.55 : 1,
          }}
        >
          <Icon name="RefreshCw" size={17} color={theme.colors.foreground} />
        </Pressable>
      </View>

      {query.isLoading ? (
        <View style={{ alignItems: "center", padding: 40, gap: 10 }}>
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={{ color: theme.colors.foregroundMuted }}>Taking the first host snapshot…</Text>
        </View>
      ) : null}

      {query.error ? (
        <View style={{ padding: 14, borderRadius: 10, backgroundColor: theme.colors.surface1 }}>
          <Text style={{ color: theme.colors.statusDanger }}>
            {query.error instanceof Error ? query.error.message : String(query.error)}
          </Text>
        </View>
      ) : null}

      {data ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Card
              theme={theme}
              compact={layout.compact}
              label="CPU"
              value={formatPercent(data.host.cpuUsagePercent)}
              percent={data.host.cpuUsagePercent ?? 0}
              detail={`${data.host.logicalCores} logical cores · load ${data.host.loadAverage[0]!.toFixed(2)}`}
            />
            <Card
              theme={theme}
              compact={layout.compact}
              label="RAM"
              value={`${formatBytes(data.memory.usedBytes)} / ${formatBytes(data.memory.totalBytes)}`}
              percent={memoryPercent}
              detail={`${formatBytes(data.memory.availableBytes)} available`}
            />
            <Card
              theme={theme}
              compact={layout.compact}
              label="Paseo tree"
              value={formatBytes(data.paseo.totalRssBytes)}
              detail={`${formatBytes(data.paseo.daemonRssBytes)} daemon · ${data.paseo.agents.length} live agents`}
            />
            <Card
              theme={theme}
              compact={layout.compact}
              label="Docker"
              value={data.docker.available ? formatBytes(data.docker.memoryBytes) : "Unavailable"}
              detail={data.docker.available
                ? `${data.docker.running}/${data.docker.total} running · ${data.docker.cpuPercent.toFixed(1)}% CPU`
                : (data.docker.error ?? "No Docker data")}
            />
          </View>

          <Section
            theme={theme}
            title="Memory detail"
            note="Linux available memory already includes reclaimable cache; these detail values intentionally overlap."
          >
            <MemoryDetail theme={theme} data={data} compact={layout.compact} />
          </Section>

          <Section
            theme={theme}
            title="Paseo processes"
            note={`RSS across ${data.paseo.processCount} processes. Shared pages may appear in more than one process.`}
          >
            <MetricRow
              theme={theme}
              title="Paseo daemon"
              detail={data.paseo.daemonPid ? `daemon PID ${data.paseo.daemonPid}` : "daemon PID unavailable"}
              value={formatBytes(data.paseo.daemonRssBytes)}
            />
            <Divider theme={theme} />
            <MetricRow
              theme={theme}
              title="Plugins + supporting services"
              detail="Paseo-owned processes not attributed to an agent"
              value={formatBytes(Math.max(0, data.paseo.coreRssBytes - data.paseo.daemonRssBytes))}
            />
            {data.paseo.agents.map((agent) => (
              <View key={agent.id}>
                <Divider theme={theme} />
                <MetricRow
                  theme={theme}
                  title={agent.title ?? `Agent ${agent.id.slice(0, 8)}`}
                  detail={`${agent.provider} · ${agent.status} · ${agent.processCount} process${agent.processCount === 1 ? "" : "es"} · ${formatPercent(agent.cpuPercent)} CPU`}
                  value={formatBytes(agent.rssBytes)}
                  onPress={navigation ? () => navigation.openAgent({ agentId: agent.id }) : undefined}
                />
              </View>
            ))}
            {data.paseo.agents.length === 0 ? (
              <Text style={{ padding: 14, color: theme.colors.foregroundMuted }}>No running agent processes found.</Text>
            ) : null}
          </Section>

          <Section
            theme={theme}
            title="Containers"
            note="Memory is Docker cgroup usage and is already part of host RAM—it is not additional usage."
          >
            {!data.docker.available ? (
              <Text style={{ padding: 14, color: theme.colors.foregroundMuted }}>{data.docker.error}</Text>
            ) : null}
            {data.docker.available && data.docker.containers.length === 0 ? (
              <Text style={{ padding: 14, color: theme.colors.foregroundMuted }}>No containers found.</Text>
            ) : null}
            {visibleContainers.map((container, index) => (
              <View key={container.id}>
                {index > 0 ? <Divider theme={theme} /> : null}
                <MetricRow
                  theme={theme}
                  title={container.name}
                  detail={`${container.state} · ${container.cpuPercent.toFixed(1)}% CPU · ${container.pids} PIDs · net ${container.netIO} · disk ${container.blockIO}`}
                  value={formatBytes(container.memoryBytes)}
                />
              </View>
            ))}
            {data.docker.containers.length > 8 ? (
              <>
                <Divider theme={theme} />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setShowAllContainers((shown) => !shown)}
                  style={{ padding: 12, alignItems: "center" }}
                >
                  <Text style={{ color: theme.colors.accent, fontWeight: "600" }}>
                    {showAllContainers ? "Show less" : `Show all ${data.docker.containers.length} containers`}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </Section>

          <Section theme={theme} title="Largest host processes" note="Top processes by resident memory (RSS).">
            {data.largestProcesses.map((row, index) => (
              <View key={row.pid}>
                {index > 0 ? <Divider theme={theme} /> : null}
                <MetricRow
                  theme={theme}
                  title={row.name}
                  detail={`PID ${row.pid} · ${formatPercent(row.cpuPercent)} CPU`}
                  value={formatBytes(row.rssBytes)}
                />
              </View>
            ))}
          </Section>

          <Section theme={theme} title="Storage">
            <View style={{ padding: 14, gap: 8 }}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Text style={{ color: theme.colors.foreground, fontWeight: "600", flex: 1 }}>Root filesystem</Text>
                <Text style={{ color: theme.colors.foreground, fontVariant: ["tabular-nums"] }}>
                  {formatBytes(data.disk.usedBytes)} / {formatBytes(data.disk.totalBytes)}
                </Text>
              </View>
              <Bar theme={theme} value={data.disk.usedPercent} />
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                {formatBytes(data.disk.availableBytes)} available · {data.disk.usedPercent.toFixed(1)}% used
              </Text>
            </View>
          </Section>

          {data.warnings.map((warning) => (
            <Text key={warning} style={{ color: theme.colors.statusWarning, fontSize: 12 }}>{warning}</Text>
          ))}

          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, textAlign: "center" }}>
            Updated {new Date(data.capturedAt).toLocaleTimeString()} · refreshes every 5 seconds while open
          </Text>
        </>
      ) : null}
    </ScrollView>
  );
}
