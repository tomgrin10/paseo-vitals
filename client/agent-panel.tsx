import type { PluginAgentPanelProps, PluginClientContext } from "@getpaseo/plugin/client";
import { useAgent } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";

import { formatBytes, formatPercent, plural } from "../shared/format";
import { vitalsAgent, type AgentTree } from "../shared/vitals";
import { History, InkBar, ink, type HistoryPoint } from "./charts";
import { Card, IconButton, errorText, text } from "./kit";
import { Skeleton } from "./motion";
import { mono, tabular } from "./theme";

const POLL_MS = 5_000;
const KEEP = 60;

/**
 * The Vitals agent panel: one agent's process tree with memory and CPU, and how both moved while
 * the panel was open. Polls only while mounted; reads the shared /proc collection, never Docker.
 */
export function agentPanel(client: PluginClientContext) {
  return function VitalsAgentPanel({ theme, params, layout }: PluginAgentPanelProps) {
    const c = theme.colors;
    const t = text(c);
    const agentTitle = useAgent(params.agentId, (snapshot) => snapshot.title);
    const [tree, setTree] = useState<AgentTree | null>(null);
    const [error, setError] = useState<string | null>(null);
    const history = useRef<{ at: number; rss: number; cpu: number | null }[]>([]);
    const [, bump] = useState(0);

    useEffect(() => {
      let live = true;
      history.current = [];
      const read = () => client.rpc(vitalsAgent, { agentId: params.agentId }).then((next) => {
        if (!live) return;
        history.current = [...history.current, { at: Date.parse(next.capturedAt), rss: next.rssBytes, cpu: next.cpuPercent }].slice(-KEEP);
        setTree(next);
        setError(null);
        bump((n) => n + 1);
      }, (cause: unknown) => { if (live) setError(errorText(cause)); });
      void read();
      const timer = setInterval(() => void read(), POLL_MS);
      return () => { live = false; clearInterval(timer); };
    }, [params.agentId]);

    // Scaled to a little above its own peak, so a steady tree reads as steady, not as maxed out.
    const peak = Math.max(1, ...history.current.map((point) => point.rss)) * 1.25;
    const memoryPoints: HistoryPoint[] = history.current.map((point) => ({ at: point.at, value: (point.rss / peak) * 100, level: "ok" }));
    const cpuPoints: HistoryPoint[] = history.current.map((point) => ({ at: point.at, value: point.cpu === null ? null : Math.min(100, point.cpu), level: "ok" }));
    const largest = Math.max(1, ...(tree?.processes.map((row) => row.rssBytes) ?? [1]));
    const title = agentTitle ?? `Agent ${params.agentId.slice(0, 8)}`;

    return (
      <ScrollView style={{ flex: 1, backgroundColor: c.surface0 }} contentContainerStyle={{ padding: layout.compact ? 16 : 20, gap: 18 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text numberOfLines={2} style={t.title}>{title}</Text>
            <Text style={t.meta}>
              {tree
                ? tree.processCount === 0 ? "No processes right now" : `${plural(tree.processCount, "process", "processes")} · ${formatPercent(tree.shareOfUsedPercent)} of RAM in use`
                : error ? "Couldn't read processes" : "Reading processes…"}
            </Text>
          </View>
          <IconButton theme={theme} icon="Gauge" label="Open Host vitals" compact={layout.compact} onPress={() => client.openScreen({ screenId: "dashboard" })} />
        </View>

        {error && !tree ? <Text style={[t.body, { color: c.statusDanger }]}>{error}</Text> : null}
        {!tree && !error ? <View style={{ gap: 10 }}><Skeleton width="60%" color={ink(c, 0.12)} /><Skeleton width="100%" height={30} color={ink(c, 0.08)} /></View> : null}

        {tree && tree.processCount > 0 ? (
          <>
            <View style={{ flexDirection: layout.compact ? "column" : "row", gap: layout.compact ? 14 : 20 }}>
              <Trace theme={theme} label="Memory" value={formatBytes(tree.rssBytes)} points={memoryPoints} format={(v) => formatBytes((v / 100) * peak)} />
              <Trace theme={theme} label="CPU" value={formatPercent(tree.cpuPercent)} points={cpuPoints} format={(v) => formatPercent(v)} />
            </View>
            <View style={{ gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
                <Text style={[t.group, { flex: 1 }]}>Processes</Text>
                <Text style={[t.small, { width: 52, textAlign: "right" }]}>CPU</Text>
                <Text style={[t.small, { width: layout.compact ? 64 : 140, textAlign: "right" }]}>Memory</Text>
              </View>
              <Card theme={theme}>
                {tree.processes.map((row, index) => (
                  <View key={row.pid} style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 7, paddingHorizontal: 12, borderTopWidth: index === 0 ? 0 : 1, borderColor: c.border }}>
                    <View style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", paddingLeft: Math.min(row.depth, 6) * 12 }}>
                      {row.depth > 0 ? <View style={{ width: 8, height: 8, marginRight: 6, marginTop: -6, borderLeftWidth: 1, borderBottomWidth: 1, borderBottomLeftRadius: 2, borderColor: ink(c, 0.3) }} /> : null}
                      <Text numberOfLines={1} style={[t.body, mono, { fontSize: 12, flexShrink: 1 }]}>{row.name}</Text>
                      <Text style={[t.small, { marginLeft: 8 }]}>{row.pid}</Text>
                    </View>
                    <Text style={[t.meta, { width: 52, textAlign: "right" }]}>{formatPercent(row.cpuPercent)}</Text>
                    <View style={{ width: layout.compact ? 64 : 140, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                      {!layout.compact ? <InkBar theme={theme} fraction={row.rssBytes / largest} width={60} /> : null}
                      <Text style={[t.meta, { color: c.foreground, width: 64, textAlign: "right", ...tabular }]}>{formatBytes(row.rssBytes)}</Text>
                    </View>
                  </View>
                ))}
              </Card>
              <Text style={t.small}>
                {tree.hiddenCount > 0 ? `${plural(tree.hiddenCount, "smaller process", "smaller processes")} not shown. ` : ""}
                Process names only; command lines stay private. Shared memory counts in each process.
              </Text>
            </View>
          </>
        ) : null}

        {tree && tree.processCount === 0 ? (
          <Text style={t.meta}>Vitals finds an agent's processes by the PASEO_AGENT_ID Paseo gives them. A stopped or archived agent has none{tree.warnings.length ? `. ${tree.warnings.join(" ")}` : "."}</Text>
        ) : null}
      </ScrollView>
    );
  };
}

function Trace({ theme, label, value, points, format }: { theme: PluginAgentPanelProps["theme"]; label: string; value: string; points: HistoryPoint[]; format: (v: number) => string }) {
  const t = text(theme.colors);
  return (
    <View style={{ flex: 1, gap: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "baseline" }}>
        <Text style={[t.label, { flex: 1 }]}>{label}</Text>
        <Text style={[t.title, { fontSize: 17, lineHeight: 22, ...tabular }]}>{value}</Text>
      </View>
      <History theme={theme} points={points} slots={Math.min(36, Math.max(points.length, 6))} height={26} label={`${label} while this panel was open`} format={format} />
      <Text style={t.small}>{points.length < 2 ? "History builds while this panel is open." : label === "Memory" ? "While this panel was open, against its peak." : "While this panel was open."}</Text>
    </View>
  );
}
