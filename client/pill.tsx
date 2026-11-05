import type { PluginButtonContentProps, PluginButtonIconProps, PluginButtonRegistration, PluginClientContext } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";

import { formatBytes, plural } from "../shared/format";
import { pressureHeadline, pressureLabel, roundPercent, type Pressure } from "../shared/pressure";
import { vitalsSnapshot, type VitalsSnapshot } from "../shared/vitals";
import type { AgentDirectory } from "./agents";
import { InkBar, Meter, levelText } from "./charts";
import { Button, errorText, text } from "./kit";
import { useLive, type Live } from "./live";
import { Spinner } from "./motion";
import { tabular } from "./theme";

interface Consumer { key: string; name: string; kind: string; bytes: number }

/** Who holds the most RAM: agents, containers and the rest of Paseo, biggest first. */
export function topConsumers(snapshot: VitalsSnapshot, limit = 4): Consumer[] {
  const rows: Consumer[] = [
    ...snapshot.paseo.agents.map((agent) => ({ key: `a:${agent.id}`, name: agent.title ?? `Agent ${agent.id.slice(0, 8)}`, kind: `${agent.provider} agent`, bytes: agent.rssBytes })),
    ...snapshot.docker.containers.map((container) => ({ key: `c:${container.id}`, name: container.name, kind: "container", bytes: container.memoryBytes })),
    { key: "paseo", name: "Paseo daemon and plugins", kind: "Paseo", bytes: snapshot.paseo.coreRssBytes },
  ];
  return rows.filter((row) => row.bytes > 0).sort((a, b) => b.bytes - a.bytes).slice(0, limit);
}

/**
 * The pressure pill: on every open agent's composer, only while RAM or disk is nearly full
 * (Progress's "only when it matters" rule). Pressure is host-wide, so every composer on the host
 * gets the same pill; it names the top users so the next step is obvious.
 */
export function contributePressurePill(client: PluginClientContext, live: Live, agents: AgentDirectory, enabled: () => boolean) {
  const registrations = new Map<string, PluginButtonRegistration>();
  let label = "";

  function PillIcon({ size, color, theme }: PluginButtonIconProps) {
    useLive(live);
    const level = live.pressure().level;
    return <Icon name={level === "critical" ? "OctagonAlert" : "TriangleAlert"} size={size} color={level === "ok" ? color : levelText(theme.colors, level)} />;
  }

  function Content({ theme, layout, close }: PluginButtonContentProps) {
    useLive(live);
    const c = theme.colors;
    const t = text(c);
    const pressure = live.pressure();
    const [snapshot, setSnapshot] = useState<VitalsSnapshot | null>(null);
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
      let live = true;
      // One full snapshot when the popover opens; the pill itself never runs it.
      client.rpc(vitalsSnapshot, {}).then((next) => { if (live) setSnapshot(next); }, (cause: unknown) => { if (live) setError(errorText(cause)); });
      return () => { live = false; };
    }, []);
    const consumers = snapshot ? topConsumers(snapshot, 3) : [];
    // Swap is shown only when it is the whole RAM story; next to RAM it repeats it.
    const items = pressure.items.filter((item) => item.resource !== "swap" || !pressure.items.some((other) => other.resource === "ram"));
    const ramTight = pressure.items.some((item) => item.resource !== "disk");
    const diskTight = pressure.items.some((item) => item.resource === "disk");
    const pulse = live.pulse();
    return (
      <View style={{ width: layout.compact ? undefined : 360, gap: 12, padding: layout.compact ? 4 : 14, paddingTop: layout.compact ? 0 : 14 }}>
        {!layout.compact ? <Text style={[t.title, { color: levelText(c, pressure.level === "ok" ? "ok" : pressure.level) }]}>{pressureHeadline(pressure)}</Text> : null}
        {/* The host popover is a fixed ~440px box: the body scrolls, the action stays pinned below it. */}
        <ScrollView style={layout.compact ? undefined : { maxHeight: 300 }} contentContainerStyle={{ gap: 14 }}>
        {items.map((item) => (
          <View key={item.resource} style={{ gap: 5 }}>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Text style={[t.label, { flex: 1 }]}>{item.resource === "ram" ? "RAM" : item.resource === "swap" ? "Swap" : "Disk"}</Text>
              <Text style={[t.label, { color: levelText(c, item.level), ...tabular }]}>{roundPercent(item.percent)}</Text>
            </View>
            <Meter theme={theme} percent={item.percent} level={item.level} label={`${item.resource} used`} />
            {item.resource === "ram" && pulse ? <Text style={t.meta}>{formatBytes(pulse.memory.availableBytes)} left of {formatBytes(pulse.memory.totalBytes)}. Agents can be killed when it runs out.</Text> : null}
            {item.resource === "disk" && pulse ? <Text style={t.meta}>{formatBytes(pulse.disk.availableBytes)} free. Builds and agents fail once it is full.</Text> : null}
          </View>
        ))}
        {ramTight ? (
          <View style={{ gap: 8 }}>
            <Text style={t.group}>Using the most RAM</Text>
            {snapshot ? consumers.map((row) => (
              <View key={row.key} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text numberOfLines={1} style={t.body}>{row.name}</Text>
                  <Text style={t.small}>{row.kind}</Text>
                </View>
                <InkBar theme={theme} fraction={row.bytes / (consumers[0]?.bytes || 1)} width={56} />
                <Text style={[t.meta, { color: c.foreground, width: 64, textAlign: "right" }]}>{formatBytes(row.bytes)}</Text>
              </View>
            )) : error ? <Text style={t.meta}>Couldn't read processes: {error}</Text> : <Spinner color={c.foregroundMuted} label="Reading processes" />}
            {snapshot && snapshot.paseo.agents.length > 0 ? <Text style={t.small}>{plural(snapshot.paseo.agents.length, "agent")} hold {formatBytes(snapshot.paseo.agentsRssBytes)} in all. Archiving idle ones frees theirs.</Text> : null}
          </View>
        ) : null}
        {diskTight ? <Text style={t.meta}>Vitals doesn't measure what fills the disk. Docker images and build caches are common: <Text style={{ color: c.foreground }}>docker system df</Text> shows them.</Text> : null}
        </ScrollView>
        <Button theme={theme} title="Open Host vitals" icon="Gauge" compact={layout.compact} grow={layout.compact}
          onPress={() => { close(); client.openScreen({ screenId: "dashboard" }); }} />
      </View>
    );
  }

  const sync = () => {
    const pressure: Pressure = live.pressure();
    const show = enabled() && pressure.level !== "ok";
    if (!show) {
      for (const registration of registrations.values()) registration.remove();
      registrations.clear();
      label = "";
      return;
    }
    const nextLabel = pressureLabel(pressure);
    // On phones the title is the sheet's heading: one sentence, the numbers are in the sheet.
    const title = pressureHeadline(pressure);
    const current = agents.current();
    for (const [agentId, registration] of registrations) {
      const agent = current.get(agentId);
      if (!agent || agent.closed) {
        registration.remove();
        registrations.delete(agentId);
      }
    }
    for (const [agentId, agent] of current) {
      if (agent.closed) continue;
      const known = registrations.get(agentId);
      if (known) {
        // Update text only: a new behavior would remount an open popover.
        if (nextLabel !== label) known.update({ label: nextLabel, title });
        continue;
      }
      registrations.set(agentId, client.addComposerPill({
        id: `pressure-${agentId}`,
        workspaceId: agent.workspaceId,
        agentId,
        button: { title, label: nextLabel, icon: PillIcon, behavior: { kind: "popover", Content } },
      }));
    }
    label = nextLabel;
  };

  const offLive = live.subscribe(sync);
  const offAgents = agents.subscribe(sync);
  return {
    sync,
    dispose() {
      offLive();
      offAgents();
      for (const registration of registrations.values()) registration.remove();
      registrations.clear();
    },
  };
}
