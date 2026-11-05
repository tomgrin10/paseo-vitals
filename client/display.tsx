import type { PluginClientContext, PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSection, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import type { z } from "zod";

import { displayPreferences, displayRpc } from "../shared/display";

export type Display = z.infer<typeof displayPreferences.schema>;
export const DEFAULT_DISPLAY: Display = { showSidebar: true, showFooter: true, showPressurePill: true };

const listeners = new Set<(values: Display) => void>();

function DisplaySettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(displayPreferences);
  const values = settings.status === "ready" ? settings.values : undefined;
  useEffect(() => {
    if (values) for (const listener of listeners) listener(values);
  }, [values?.showSidebar, values?.showFooter, values?.showPressurePill]);

  if (settings.status === "loading") return <ActivityIndicator accessibilityLabel="Loading display settings" color={theme.colors.foregroundMuted} />;
  if (settings.status !== "ready") return (
    <View style={{ gap: 12, paddingVertical: 16 }}>
      <Text style={{ color: theme.colors.statusDanger }}>{settings.error}</Text>
      <SettingsCard>
        <SettingsAction label="Try loading the saved settings again" actionLabel="Retry" onPress={() => void settings.reload()} />
        {settings.status === "invalid" && <SettingsAction label="Replace invalid display settings with defaults" actionLabel="Reset" disabled={settings.saving} onPress={() => void settings.reset()} />}
      </SettingsCard>
      {settings.saveError && <Text style={{ color: theme.colors.statusDanger }}>{settings.saveError}</Text>}
    </View>
  );

  const save = (patch: Partial<Display>) => void settings.save({ ...settings.values, ...patch }, settings.revision);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 16, gap: 20 }}>
      <SettingsSection title="Sidebar">
        <SettingsCard>
          <SettingsSwitch label="Host vitals row" hint="Opens the dashboard. Without it, use ⌘K (Ctrl+K)." value={settings.values.showSidebar}
            disabled={settings.saving} onValueChange={(showSidebar) => save({ showSidebar })} />
          <SettingsSwitch label="Live meters in the footer" hint="CPU, RAM and disk; click for the last five minutes." value={settings.values.showFooter}
            disabled={settings.saving} onValueChange={(showFooter) => save({ showFooter })} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Warnings">
        <SettingsCard>
          <SettingsSwitch label="Warn on the composer when RAM or disk is nearly full" hint="At 90%, with what is using the most RAM." value={settings.values.showPressurePill}
            disabled={settings.saving} onValueChange={(showPressurePill) => save({ showPressurePill })} />
        </SettingsCard>
      </SettingsSection>
      {settings.saveError && <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{settings.saveError}</Text>}
    </ScrollView>
  );
}

/**
 * The Display settings screen, plus the saved values for code outside React. Settings
 * notifications reach mounted screens; a slow poll picks up changes made on other clients.
 */
export function contributeDisplay(client: PluginClientContext, apply: (values: Display) => void) {
  const removeSettings = client.addSettingsScreen({ id: "display", title: "Display", icon: "PanelLeft", Component: DisplaySettings });
  const removeCommand = client.addCommandCenterItem({
    id: "display-settings",
    title: "Host vitals: display settings",
    icon: "PanelLeft",
    keywords: ["vitals", "sidebar", "footer", "meters", "warning", "show", "hide", "display", "settings"],
    context: "global",
    onSelect({ openSettings }) { openSettings("display"); },
  });
  let disposed = false;
  let pending = false;
  let generation = 0;
  const update = (values: Display) => { generation += 1; apply(values); };
  listeners.add(update);
  const refresh = async () => {
    if (disposed || pending) return;
    pending = true;
    const currentGeneration = generation;
    try {
      const result = await client.rpc(displayRpc.read, {});
      if (!disposed && generation === currentGeneration && result.status === "ready") {
        const parsed = displayPreferences.schema.safeParse(result.values);
        if (parsed.success) apply(parsed.data);
      }
    } catch {
      // Keep the last valid preference through temporary disconnects.
    } finally { pending = false; }
  };
  void refresh();
  const timer = setInterval(() => void refresh(), 15_000);
  return () => {
    disposed = true;
    clearInterval(timer);
    listeners.delete(update);
    removeSettings();
    removeCommand();
  };
}
