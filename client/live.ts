import { useEffect, useSyncExternalStore } from "react";

import { pressureOf, type Pressure } from "../shared/pressure.ts";
import type { VitalsPulse } from "../shared/vitals.ts";

export const PULSE_POLL_MS = 5_000;

/** Pushed pulses (Paseo 0.16): calls `onPulse` per sample until released; `onClosed` if the daemon ends it. */
export type PulseStream = (onPulse: (pulse: VitalsPulse) => void, onClosed: (error?: Error) => void) => { release(): void; ready: Promise<void> };

/** How long a dropped stream waits before subscribing again, polling meanwhile. */
export const STREAM_RETRY_MS = 15_000;

/**
 * One light poll per installation (each host's client bundle has its own), shared by the footer
 * meters, their popover, the pressure pills and the dashboard's history columns. It runs only
 * while something is watching: a hidden footer with the pill turned off polls nothing.
 *
 * With a `stream` (Paseo 0.16) the daemon pushes each sample instead: watched means subscribed,
 * and the last release ends the subscription. A refused stream falls back to polling for good; a
 * dropped one polls while it waits to subscribe again, so the meters never freeze.
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

export function createLive(read: () => Promise<VitalsPulse>, intervalMs = PULSE_POLL_MS, stream?: PulseStream, retryMs = STREAM_RETRY_MS): Live {
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

  const accept = (next: VitalsPulse) => {
    if (disposed) return;
    pulse = next;
    pressure = pressureOf(next);
    error = null;
    notify();
  };

  let subscription: { release(): void } | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  /** Set when the daemon refused the stream: poll from then on. */
  let streamRefused = !stream;

  const startPolling = () => {
    if (timer || disposed) return;
    void refresh();
    timer = setInterval(() => void refresh(), intervalMs);
  };
  const stopPolling = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const stopStream = () => {
    if (retry) clearTimeout(retry);
    retry = null;
    const current = subscription;
    subscription = null;
    current?.release();
  };
  const startStream = () => {
    if (!stream || streamRefused || subscription || disposed) return;
    let open = true;
    let handle: { release(): void; ready: Promise<void> } | null = null;
    const closed = () => {
      if (!open) return;
      open = false;
      if (subscription === handle) subscription = null;
      if (watchers === 0 || disposed) return;
      // Dropped (reconnect, plugin reload): keep the meters moving, then try the push again.
      startPolling();
      retry ??= setTimeout(() => {
        retry = null;
        if (watchers > 0 && !subscription && !streamRefused && !disposed) { stopPolling(); startStream(); }
      }, retryMs);
    };
    try {
      handle = stream(accept, closed);
    } catch {
      streamRefused = true;
      startPolling();
      return;
    }
    if (!open) return; // closed before it returned; `closed` already fell back to polling
    subscription = handle;
    handle.ready.catch(() => {
      // Refused (an older daemon side): this installation polls from now on.
      streamRefused = true;
      open = false;
      if (retry) clearTimeout(retry);
      retry = null;
      if (subscription === handle) subscription = null;
      if (watchers > 0) startPolling();
    });
  };

  const refresh = () => {
    if (disposed) return Promise.resolve();
    pending ??= read()
      .then(accept)
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
        if (streamRefused) startPolling();
        else startStream();
      }
      let released = false;
      return () => {
        if (released) return;
        released = true;
        watchers -= 1;
        if (watchers === 0) {
          stopPolling();
          stopStream();
        }
      };
    },
    refresh,
    dispose() {
      disposed = true;
      stopPolling();
      stopStream();
      listeners.clear();
    },
  };
}

/** Subscribe a component and keep the poll alive while it is mounted. */
export function useLive(live: Live): number {
  useEffect(() => live.watch(), [live]);
  return useSyncExternalStore(live.subscribe, live.version, live.version);
}

type SubscribeFn = (contract: unknown, input: object, onEvent: (event: VitalsPulse) => void, options: { onClosed(closed: { error?: Error }): void }) => (() => void) & { ready: Promise<void> };

/** The pushed pulse through `client.subscribe` (Paseo 0.16), or undefined on a host without it. */
export function pulseStreamOf(client: unknown, contract: unknown): PulseStream | undefined {
  const subscribe = (client as { subscribe?: unknown } | null)?.subscribe;
  if (typeof subscribe !== "function") return undefined;
  return (onPulse, onClosed) => {
    const handle = (subscribe as SubscribeFn).call(client, contract, {}, onPulse, { onClosed: ({ error }) => onClosed(error) });
    return { release: () => handle(), ready: handle.ready };
  };
}
