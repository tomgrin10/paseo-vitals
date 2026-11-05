import { useEffect, useSyncExternalStore } from "react";

import { pressureOf, type Pressure } from "../shared/pressure.ts";
import type { VitalsPulse } from "../shared/vitals.ts";

export const PULSE_POLL_MS = 5_000;

/**
 * One light poll per installation (each host's client bundle has its own), shared by the footer
 * meters, their popover, the pressure pills and the dashboard's history columns. It runs only
 * while something is watching: a hidden footer with the pill turned off polls nothing.
 */
export interface Live {
  pulse(): VitalsPulse | null;
  pressure(): Pressure;
  error(): string | null;
  version(): number;
  subscribe(listener: () => void): () => void;
  /** Keep polling while the returned release has not been called. */
  watch(): () => void;
  refresh(): Promise<void>;
  dispose(): void;
}

const calm: Pressure = { level: "ok", items: [] };

export function createLive(read: () => Promise<VitalsPulse>, intervalMs = PULSE_POLL_MS): Live {
  let pulse: VitalsPulse | null = null;
  let pressure = calm;
  let error: string | null = null;
  let version = 0;
  let watchers = 0;
  let timer: ReturnType<typeof setInterval> | null = null;
  let pending: Promise<void> | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const notify = () => {
    version += 1;
    for (const listener of [...listeners]) listener();
  };

  const refresh = () => {
    if (disposed) return Promise.resolve();
    pending ??= read()
      .then((next) => {
        if (disposed) return;
        pulse = next;
        pressure = pressureOf(next);
        error = null;
        notify();
      })
      .catch((cause: unknown) => {
        if (disposed) return;
        // Keep the last reading through a short disconnect; say so only once there is none.
        error = cause instanceof Error ? cause.message : String(cause);
        notify();
      })
      .finally(() => { pending = null; });
    return pending;
  };

  return {
    pulse: () => pulse,
    pressure: () => pressure,
    error: () => error,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    watch() {
      watchers += 1;
      if (watchers === 1 && !disposed) {
        void refresh();
        timer = setInterval(() => void refresh(), intervalMs);
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        watchers -= 1;
        if (watchers === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
    refresh,
    dispose() {
      disposed = true;
      if (timer) clearInterval(timer);
      timer = null;
      listeners.clear();
    },
  };
}

/** Subscribe a component and keep the poll alive while it is mounted. */
export function useLive(live: Live): number {
  useEffect(() => live.watch(), [live]);
  return useSyncExternalStore(live.subscribe, live.version, live.version);
}
