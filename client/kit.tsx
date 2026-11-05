import { useEffect, useState, type ReactNode } from "react";
import { Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { PressScale, Spinner } from "./motion";
import {
  raised,
  tabular,
  tint,
  withAlpha,
  type Colors,
  type Theme,
} from "./theme";

export type { Theme } from "./theme";

/** Re-render on an interval so relative times keep moving. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The family type scale: tabular numerals wherever a time or count can appear. */
export const text = (colors: Colors) => ({
  title: {
    color: colors.foreground,
    fontSize: 15,
    lineHeight: 21,
    fontWeight: "600" as const,
  },
  body: { color: colors.foreground, fontSize: 13, lineHeight: 19 },
  meta: {
    color: colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 17,
    ...tabular,
  },
  small: {
    color: colors.foregroundMuted,
    fontSize: 11,
    lineHeight: 15,
    ...tabular,
  },
  label: {
    color: colors.foreground,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600" as const,
  },
  group: {
    color: colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "600" as const,
    ...tabular,
  },
});

type ButtonKind = "primary" | "secondary" | "ghost";
/** One button vocabulary: 28–32px with a hit slop on desktop, 44px on touch layouts. */
export function Button({
  title,
  onPress,
  theme,
  kind = "secondary",
  disabled = false,
  loading = false,
  icon,
  compact = false,
  small = false,
  accessibilityLabel,
  accessibilityHint,
  grow = false,
  trailing,
}: {
  title: string;
  onPress: () => void;
  theme: Theme;
  kind?: ButtonKind;
  disabled?: boolean;
  loading?: boolean;
  icon?: string;
  compact?: boolean;
  small?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  grow?: boolean;
  /** A short keyboard hint after the title (desktop only), e.g. ↵. */
  trailing?: string;
}) {
  const c = theme.colors;
  const fg = kind === "primary" ? c.accentForeground : c.foreground;
  const inactive = disabled || loading;
  const height = compact ? 44 : small ? 28 : 32;
  return (
    <PressScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      hitSlop={compact ? 0 : 4}
      outerStyle={grow ? { flexGrow: 1 } : { alignSelf: "flex-start" }}
      style={({ pressed, hovered }) => ({
        minHeight: height,
        paddingHorizontal: compact ? 14 : small ? 9 : 11,
        borderRadius: compact ? 8 : 6,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        opacity: disabled ? 0.45 : 1,
        ...(kind === "primary"
          ? {
              backgroundColor: pressed
                ? withAlpha(c.accent, 0.85)
                : hovered
                  ? withAlpha(c.accent, 0.92)
                  : c.accent,
            }
          : kind === "ghost"
            ? {
                backgroundColor: pressed
                  ? c.surface2
                  : hovered
                    ? c.surface1
                    : "transparent",
              }
            : {
                ...raised(c),
                backgroundColor: pressed
                  ? c.surface2
                  : hovered
                    ? c.surface2
                    : c.surface1,
              }),
      })}
    >
      {loading ? (
        <Spinner color={fg} size={12} />
      ) : icon ? (
        <Icon name={icon} size={compact ? 16 : 14} color={fg} />
      ) : null}
      <Text
        numberOfLines={1}
        style={{
          color: fg,
          fontSize: compact ? 14 : small ? 12 : 13,
          lineHeight: compact ? 19 : 16,
          fontWeight: kind === "primary" ? "600" : "500",
          ...tabular,
        }}
      >
        {title}
      </Text>
      {trailing && !compact ? (
        <Text
          style={{ color: withAlpha(fg, 0.7), fontSize: 12, lineHeight: 16 }}
        >
          {trailing}
        </Text>
      ) : null}
    </PressScale>
  );
}

/** A square icon-only control with an accessible name. `on` draws it as a pressed toggle. */
export function IconButton({
  icon,
  label,
  onPress,
  theme,
  compact = false,
  disabled = false,
  color,
  on,
  size,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  theme: Theme;
  compact?: boolean;
  disabled?: boolean;
  color?: string;
  on?: boolean;
  size?: number;
}) {
  const c = theme.colors;
  const box = size ?? (compact ? 44 : 28);
  return (
    <PressScale
      accessibilityRole={on === undefined ? "button" : "switch"}
      accessibilityLabel={label}
      accessibilityState={
        on === undefined ? { disabled } : { checked: on, disabled }
      }
      disabled={disabled}
      onPress={onPress}
      hitSlop={compact ? 0 : 6}
      style={({ pressed, hovered }) => ({
        width: box,
        height: box,
        borderRadius: 6,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: on ? 1 : 0,
        borderColor: c.foreground,
        backgroundColor: on
          ? c.surface2
          : pressed
            ? c.surface2
            : hovered
              ? c.surface1
              : "transparent",
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <Icon
        name={icon}
        size={compact ? 18 : 15}
        color={color ?? (on ? c.foreground : c.foregroundMuted)}
      />
    </PressScale>
  );
}

/** A raised container. Groups of rows sit inside one; rows divide with hairlines. */
export function Card({
  theme,
  children,
  style,
}: {
  theme: Theme;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = theme.colors;
  return (
    <View
      style={[
        { borderRadius: 10, overflow: "hidden", backgroundColor: c.surface0 },
        raised(c),
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A neutral selectable chip: selection is a foreground ring on surface2, never the accent. */
export function choiceStyle(
  colors: Colors,
  on: boolean,
  state: { pressed: boolean; hovered?: boolean },
): ViewStyle {
  return {
    minHeight: 30,
    paddingHorizontal: 11,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
    borderColor: on ? colors.foreground : colors.border,
    backgroundColor: on
      ? colors.surface2
      : state.pressed
        ? colors.surface2
        : state.hovered
          ? colors.surface1
          : "transparent",
  };
}

/** A count or status tag in its own hue at 12–16% (Follow-up's chip). */
export function Chip({
  theme,
  label,
  color,
  icon,
}: {
  theme: Theme;
  label: string;
  color?: string;
  icon?: string;
}) {
  const c = theme.colors;
  const hue = color ?? c.foregroundMuted;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 999,
        backgroundColor: tint(hue, c),
        alignSelf: "center",
        flexShrink: 1,
      }}
    >
      {icon ? <Icon name={icon} size={11} color={hue} /> : null}
      <Text
        numberOfLines={1}
        style={{
          color: hue,
          fontSize: 11,
          lineHeight: 16,
          fontWeight: "600",
          flexShrink: 1,
          ...tabular,
        }}
      >
        {label}
      </Text>
    </View>
  );
}

/** A group heading with its count: "Today  3". */
export function GroupLabel({
  theme,
  label,
  count,
}: {
  theme: Theme;
  label: string;
  count?: number;
}) {
  const c = theme.colors;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
      <Text
        accessibilityRole="header"
        style={{
          color: c.foregroundMuted,
          fontSize: 12,
          lineHeight: 16,
          fontWeight: "600",
        }}
      >
        {label}
      </Text>
      {count === undefined ? null : (
        <Chip theme={theme} label={String(count)} />
      )}
    </View>
  );
}

/** A soft keyboard key: `↵`, `↑↓`, `esc`. Desktop hints only. */
export function Kbd({ theme, label }: { theme: Theme; label: string }) {
  const c = theme.colors;
  return (
    <View
      style={{
        paddingHorizontal: 5,
        minWidth: 18,
        height: 18,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: c.border,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: c.foregroundMuted, fontSize: 11, lineHeight: 14 }}>
        {label}
      </Text>
    </View>
  );
}
