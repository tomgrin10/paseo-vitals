import { type PluginClientContext, type PluginScreenProps, useRpc } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View, type LayoutChangeEvent, type PressableStateCallbackType } from "react-native";

import { compositionOf } from "../shared/composition";
import { formatAgo, formatBytes, formatDuration, formatPercent, plural } from "../shared/format";
import { pressureHeadline, pressureOf, share } from "../shared/pressure";
import { vitalsSnapshot, type VitalsSnapshot } from "../shared/vitals";
import { CompositionBar, InkBar, Swatch, ink, levelText, segmentColor } from "./charts";
import { Instrument, readingsOf } from "./instruments";
import { Button, Card, Chip, IconButton, errorText, text, useNow } from "./kit";
import { useLive, type Live } from "./live";
import { Reveal, Skeleton } from "./motion";
import { mono, tabular, type Theme } from "./theme";

const SHOWN = 8;
export const AGENT_PANEL_ID = "vitals-agent";

function Section({ theme, title, count, meta, children }: { theme: Theme; title: string; count?: number; meta?: string; children: ReactNode }) {
  const t = text(theme.colors);
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 7, minHeight: 20 }}>
        <Text accessibilityRole="header" style={[t.label, { fontSize: 14 }]}>{title}</Text>
        {count === undefined ? null : <Chip theme={theme} label={String(count)} />}
        <View style={{ flex: 1 }} />
        {meta ? <Text numberOfLines={1} style={[t.meta, { flexShrink: 1 }]}>{meta}</Text> : null}
      </View>
      <Card theme={theme}>{children}</Card>
    </View>
  );
}

function Row({ theme, compact, first, title, titleMono, meta, cpu, bytes, fraction, onPress, accessory, slot, label, muted }: {
  theme: Theme; compact: boolean; first: boolean; title: string; titleMono?: boolean; meta: string; cpu: string | null;
  bytes: number | null; fraction: number; onPress?: () => void; accessory?: ReactNode; label?: string;
  /** Reserve the accessory's width so columns line up with rows that have one. */
  slot?: boolean; muted?: boolean;
}) {
  const c = theme.colors;
  const t = text(c);
  const body = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: compact ? 10 : 9, paddingLeft: 14, paddingRight: accessory || slot ? 6 : 14, opacity: muted ? 0.6 : 1 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text numberOfLines={compact ? 2 : 1} style={[t.body, { fontWeight: "500" }, titleMono ? [mono, { fontSize: 12 }] : null]}>{title}</Text>
        <Text numberOfLines={compact ? 3 : 1} style={t.small}>{meta}</Text>
      </View>
      {cpu !== null ? <Text style={[t.meta, { width: compact ? 44 : 56, textAlign: "right" }]}>{cpu}</Text> : null}
      {!compact ? <InkBar theme={theme} fraction={fraction} /> : null}
      <Text style={[t.meta, { color: c.foreground, width: 64, textAlign: "right", fontWeight: "500" }]}>{bytes === null ? "–" : formatBytes(bytes)}</Text>
      {accessory ?? (slot ? <View style={{ width: compact ? 44 : 28 }} /> : null)}
    </View>
  );
  return (
    <View style={{ borderTopWidth: first ? 0 : 1, borderColor: c.border }}>
      {onPress ? (
        <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} onPress={onPress}
          style={(state: PressableStateCallbackType & { hovered?: boolean }) => ({ backgroundColor: state.pressed ? c.surface2 : state.hovered ? c.surface1 : "transparent" })}>
          {body}
        </Pressable>
      ) : body}
    </View>
  );
}

function ColumnHeads({ theme, compact, cpu = true }: { theme: Theme; compact: boolean; cpu?: boolean }) {
  const t = text(theme.colors);
  return (
    <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6, borderBottomWidth: 1, borderColor: theme.colors.border }}>
      <View style={{ flex: 1 }} />
      {cpu ? <Text style={[t.small, { width: compact ? 44 : 56, textAlign: "right" }]}>CPU</Text> : null}
      <Text style={[t.small, { width: compact ? 64 : 72 + 12 + 64, textAlign: "right" }]}>Memory</Text>
    </View>
  );
}

function MemorySection({ theme, data, compact }: { theme: Theme; data: VitalsSnapshot; compact: boolean }) {
  const c = theme.colors;
  const t = text(c);
  const composition = compositionOf(data);
  return (
    <Section theme={theme} title="Memory in use" meta={`${formatBytes(composition.usedBytes)} of ${formatBytes(composition.totalBytes)}`}>
      <View style={{ padding: 14, gap: 12 }}>
        <CompositionBar theme={theme} composition={composition} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 10 }}>
          {composition.segments.map((segment) => (
            <View key={segment.key} style={{ width: compact ? "50%" : "25%", flexDirection: "row", gap: 7, paddingRight: 8 }}>
              <View style={{ paddingTop: 4 }}><Swatch color={segmentColor(c, segment.key)} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={t.meta}>{segment.label}</Text>
                <Text style={[t.label, tabular]}>
                  {formatBytes(segment.bytes)}
                  <Text style={[t.meta, { fontWeight: "400" }]}>  {formatPercent(share(segment.bytes, composition.usedBytes))}</Text>
                </Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={t.small}>
          {formatBytes(data.memory.cacheBytes)} of file cache is left out: Linux frees it when programs need room.
          {composition.scaled ? " Shared pages count once per process, so the parts are scaled to fit." : ""}
        </Text>
      </View>
    </Section>
  );
}

export function dashboard(client: PluginClientContext, live: Live) {
  return function VitalsScreen({ theme, host, layout, navigation }: PluginScreenProps) {
    useLive(live);
    const c = theme.colors;
    const t = text(c);
    const now = useNow(1_000);
    const readVitals = useRpc(vitalsSnapshot);
    const [width, setWidth] = useState<number | null>(null);
    const [allAgents, setAllAgents] = useState(false);
    const [allContainers, setAllContainers] = useState(false);
    const query = useQuery({
      queryKey: ["paseo-vitals", host.id],
      queryFn: () => readVitals({}),
      refetchInterval: 5_000,
      staleTime: 2_500,
    });
    const data = query.data;
    const pulse = live.pulse();
    const compact = layout.compact || (width !== null && width < 640);
    const wide = width !== null && width >= 760;
    const pressure = pulse ? live.pressure() : data ? pressureOf(data) : null;
    const pad = compact ? 16 : 28;

    const agents = data?.paseo.agents ?? [];
    const shownAgents = allAgents ? agents : agents.slice(0, SHOWN);
    const biggestAgent = Math.max(1, ...agents.map((agent) => agent.rssBytes));
    const containers = data?.docker.containers ?? [];
    const shownContainers = allContainers ? containers : containers.slice(0, SHOWN);
    const biggestContainer = Math.max(1, ...containers.map((container) => container.memoryBytes));
    const biggestProcess = Math.max(1, ...(data?.largestProcesses.map((row) => row.rssBytes) ?? [1]));
    const updated = data ? Date.parse(data.capturedAt) : null;

    return (
      <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ width: "100%", maxWidth: 980, alignSelf: "center", padding: pad, paddingTop: compact ? 16 : 24, gap: 24 }}>
        <View onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)} style={{ gap: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text numberOfLines={1} style={[t.title, { fontSize: 19, lineHeight: 25 }]}>{data?.host.hostname ?? pulse?.hostname ?? host.label}</Text>
              {/* Wide: one line with centred dots. Compact: the sentence, then the facts on their own
                  line with commas, which may end a line where a "·" may not. */}
              <Text style={t.meta}>
                <Text style={{ color: !pressure || pressure.level === "ok" ? c.foreground : levelText(c, pressure.level), fontWeight: "600" }}>
                  {pressure ? pressureHeadline(pressure) : "Reading this host…"}
                </Text>
                {data ? (compact ? "\n" : "  ·  ") + [data.host.platform, data.host.arch, `up\u00a0${formatDuration(data.host.uptimeSeconds)}`].join(compact ? ", " : " · ") : null}
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              {updated && !compact ? <Text style={t.small}>Updated {formatAgo(updated, now)}</Text> : null}
              <IconButton theme={theme} icon="RefreshCw" label="Refresh host vitals" compact={layout.compact} disabled={query.isFetching}
                onPress={() => { void query.refetch(); void live.refresh(); }} />
            </View>
          </View>

          <Card theme={theme}>
            {pulse ? readingsOf(pulse).map((reading, index) => (
              <View key={reading.key} style={{ paddingHorizontal: 14, paddingVertical: wide ? 12 : 11, borderTopWidth: index === 0 ? 0 : 1, borderColor: c.border }}>
                <Instrument theme={theme} reading={reading} wide={wide} />
              </View>
            )) : (
              <View style={{ padding: 14, gap: 14 }}>
                {[0, 1, 2, 3].map((index) => <Skeleton key={index} width="100%" height={22} color={ink(c, 0.07)} />)}
              </View>
            )}
          </Card>
          {pulse ? <Text style={[t.small, { marginTop: -6 }]}>Traces show the last five minutes{wide ? "; point at a column for its reading" : ""}.</Text> : null}
        </View>

        {query.error && !data ? (
          <View style={{ gap: 10, alignItems: "flex-start" }}>
            <Text style={[t.body, { color: c.statusDanger }]}>Couldn't read processes and containers: {errorText(query.error)}</Text>
            <Button theme={theme} title="Try again" icon="RefreshCw" compact={layout.compact} onPress={() => void query.refetch()} />
          </View>
        ) : null}

        {data ? (
          <Reveal>
            <View style={{ gap: 24 }}>
              <MemorySection theme={theme} data={data} compact={compact} />

              <Section theme={theme} title="Agents" count={agents.length}
                meta={agents.length ? `${formatBytes(data.paseo.agentsRssBytes)} · Paseo itself ${formatBytes(data.paseo.coreRssBytes)}` : undefined}>
                {agents.length ? <ColumnHeads theme={theme} compact={compact} /> : null}
                {shownAgents.map((agent, index) => (
                  <Row key={agent.id} theme={theme} compact={compact} first={index === 0}
                    title={agent.title ?? `Agent ${agent.id.slice(0, 8)}`}
                    meta={`${agent.provider} · ${agent.status} · ${plural(agent.processCount, "process", "processes")}`}
                    cpu={formatPercent(agent.cpuPercent)} bytes={agent.rssBytes} fraction={agent.rssBytes / biggestAgent}
                    label={`Open ${agent.title ?? "agent"}`}
                    onPress={navigation ? () => navigation.openAgent({ agentId: agent.id }) : undefined}
                    accessory={agent.workspaceId ? (
                      <IconButton theme={theme} icon="ListTree" label={`Processes of ${agent.title ?? "this agent"}`} compact={layout.compact}
                        onPress={() => client.openPanel(AGENT_PANEL_ID, { workspaceId: agent.workspaceId!, agentId: agent.id })} />
                    ) : undefined}
                  />
                ))}
                {agents.length > SHOWN ? (
                  <Pressable accessibilityRole="button" onPress={() => setAllAgents((shown) => !shown)} style={{ padding: 11, alignItems: "center", borderTopWidth: 1, borderColor: c.border }}>
                    <Text style={[t.meta, { color: c.foreground, fontWeight: "500" }]}>{allAgents ? "Show fewer" : `Show all ${agents.length} agents`}</Text>
                  </Pressable>
                ) : null}
                <Row theme={theme} compact={compact} first={agents.length === 0} title="Paseo daemon and plugins" slot={agents.some((agent) => agent.workspaceId)}
                  meta={`${plural(data.paseo.processCount - agents.reduce((sum, agent) => sum + agent.processCount, 0), "process", "processes")} not tied to an agent · daemon ${formatBytes(data.paseo.daemonRssBytes)}`}
                  cpu={null} bytes={data.paseo.coreRssBytes} fraction={data.paseo.coreRssBytes / biggestAgent} />
                {agents.length === 0 ? <Text style={[t.small, { paddingHorizontal: 14, paddingBottom: 12 }]}>No agent processes are running.</Text> : null}
              </Section>

              <Section theme={theme} title="Containers" count={data.docker.available ? data.docker.total : undefined}
                meta={data.docker.available && data.docker.total ? `${data.docker.running} running · ${formatBytes(data.docker.memoryBytes)} · ${formatPercent(data.docker.cpuPercent)} CPU` : undefined}>
                {!data.docker.available ? <Text style={[t.meta, { padding: 14 }]}>{data.docker.error}</Text> : null}
                {data.docker.available && containers.length === 0 ? <Text style={[t.meta, { padding: 14 }]}>No containers on this host.</Text> : null}
                {containers.length ? <ColumnHeads theme={theme} compact={compact} /> : null}
                {shownContainers.map((container, index) => (
                  container.state.toLowerCase() === "running" ? (
                    <Row key={container.id} theme={theme} compact={compact} first={index === 0} title={container.name}
                      meta={`${plural(container.pids, "PID")} · net ${container.netIO} · disk ${container.blockIO}`}
                      cpu={formatPercent(container.cpuPercent)} bytes={container.memoryBytes} fraction={container.memoryBytes / biggestContainer} />
                  ) : (
                    <Row key={container.id} theme={theme} compact={compact} first={index === 0} title={container.name} muted
                      meta={container.status} cpu="–" bytes={null} fraction={0} />
                  )
                ))}
                {containers.length > SHOWN ? (
                  <Pressable accessibilityRole="button" onPress={() => setAllContainers((shown) => !shown)} style={{ padding: 11, alignItems: "center", borderTopWidth: 1, borderColor: c.border }}>
                    <Text style={[t.meta, { color: c.foreground, fontWeight: "500" }]}>{allContainers ? "Show fewer" : `Show all ${containers.length} containers`}</Text>
                  </Pressable>
                ) : null}
              </Section>

              {data.largestProcesses.length ? (
                <Section theme={theme} title="Largest processes" meta="by resident memory">
                  <ColumnHeads theme={theme} compact={compact} />
                  {data.largestProcesses.map((row, index) => (
                    <Row key={row.pid} theme={theme} compact={compact} first={index === 0} title={row.name} titleMono
                      meta={`PID ${row.pid}`} cpu={formatPercent(row.cpuPercent)} bytes={row.rssBytes} fraction={row.rssBytes / biggestProcess} />
                  ))}
                </Section>
              ) : null}

              <View style={{ gap: 4 }}>
                {data.warnings.map((warning) => <Text key={warning} style={[t.meta, { color: c.statusWarning }]}>{warning}</Text>)}
                <Text style={t.small}>
                  Updates every 5 seconds while open. Memory is resident set size (RSS); command lines and environment values never leave the host.
                </Text>
              </View>
            </View>
          </Reveal>
        ) : null}
      </ScrollView>
    );
  };
}
