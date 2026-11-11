import assert from "node:assert/strict";
import test from "node:test";

import { createLive } from "../client/live.ts";

const pulse = (ram: number) => ({
  capturedAt: "", hostname: "h", uptimeSeconds: 1, logicalCores: 1, loadAverage: [0, 0, 0], cpuPercent: 1,
  memory: { totalBytes: 100, usedBytes: ram, availableBytes: 100 - ram, swapTotalBytes: 0, swapUsedBytes: 0 },
  disk: { path: "/", totalBytes: 100, usedBytes: 10, availableBytes: 90, usedPercent: 10 }, intervalMs: 5000, history: [],
});

test("the live store polls only while watched and derives pressure", async () => {
  let reads = 0;
  let ram = 50;
  const live = createLive(async () => { reads += 1; return pulse(ram); }, 10);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(reads, 0, "nothing watching, nothing read");
  const releaseA = live.watch();
  const releaseB = live.watch();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(live.pressure().level, "ok");
  ram = 96;
  await live.refresh();
  assert.equal(live.pressure().level, "critical");
  releaseA();
  releaseA();
  const count = reads;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.ok(reads > count, "one watcher left keeps polling");
  releaseB();
  const stopped = reads;
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(reads, stopped);
  live.dispose();
});

test("a failed read keeps the last pulse", async () => {
  let fail = false;
  const live = createLive(async () => { if (fail) throw new Error("offline"); return pulse(40); }, 1000);
  await live.refresh();
  fail = true;
  await live.refresh();
  assert.equal(live.pulse()?.memory.usedBytes, 40);
  assert.equal(live.error(), "offline");
  live.dispose();
});

/** A fake 0.16 stream: records subscriptions; `emit` pushes, `drop` closes from the daemon side. */
function fakeStream({ refuse = false } = {}) {
  const subs: { onPulse: (p: ReturnType<typeof pulse>) => void; onClosed: (e?: Error) => void; released: boolean }[] = [];
  return {
    subs,
    open: () => subs.filter((sub) => !sub.released),
    stream: (onPulse: (p: ReturnType<typeof pulse>) => void, onClosed: (e?: Error) => void) => {
      const sub = { onPulse, onClosed, released: false };
      subs.push(sub);
      return { release: () => { sub.released = true; }, ready: refuse ? Promise.reject(new Error("refused")) : Promise.resolve() };
    },
    emit: (ram: number) => { for (const sub of subs) if (!sub.released) sub.onPulse(pulse(ram)); },
    drop: () => { for (const sub of subs) if (!sub.released) { sub.released = true; sub.onClosed(new Error("gone")); } },
  };
}
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

test("with a stream, watched means subscribed: one subscription, no reads, released with the last watcher", async () => {
  let reads = 0;
  const s = fakeStream();
  const live = createLive(async () => { reads += 1; return pulse(10); }, 10, s.stream as never, 20);
  await tick(30);
  assert.equal(s.subs.length, 0, "nothing watching, nothing subscribed");
  const releaseA = live.watch();
  const releaseB = live.watch();
  assert.equal(s.subs.length, 1, "one subscription per installation");
  s.emit(96);
  assert.equal(live.pressure().level, "critical", "a pushed sample updates the meters");
  await tick(40);
  assert.equal(reads, 0, "pushed, not polled");
  releaseA();
  assert.equal(s.open().length, 1, "one watcher left keeps the subscription");
  releaseB();
  assert.equal(s.open().length, 0, "the last release ends it");
  await tick(40);
  assert.equal(reads, 0);
  live.dispose();
});

test("a refused stream falls back to polling for good", async () => {
  let reads = 0;
  const s = fakeStream({ refuse: true });
  const live = createLive(async () => { reads += 1; return pulse(10); }, 10, s.stream as never, 20);
  const release = live.watch();
  await tick(45);
  assert.ok(reads >= 2, `polls instead (read ${reads})`);
  release();
  const stopped = reads;
  await tick(30);
  assert.equal(reads, stopped, "and stops polling when unwatched");
  const again = live.watch();
  await tick(5);
  assert.equal(s.subs.length, 1, "never asks again after a refusal");
  again();
  live.dispose();
});

test("a dropped stream polls meanwhile, then subscribes again and stops polling", async () => {
  let reads = 0;
  const s = fakeStream();
  const live = createLive(async () => { reads += 1; return pulse(10); }, 10, s.stream as never, 35);
  const release = live.watch();
  s.drop();
  await tick(25);
  assert.ok(reads >= 1, "the meters keep moving while the push is gone");
  await tick(30);
  assert.equal(s.open().length, 1, "subscribed again after the retry delay");
  const at = reads;
  await tick(40);
  assert.equal(reads, at, "polling stops once pushed again");
  release();
  assert.equal(s.open().length, 0);
  live.dispose();
});

test("pulseStreamOf feature-detects client.subscribe", async () => {
  const { pulseStreamOf } = await import("../client/live.ts");
  assert.equal(pulseStreamOf({ rpc() {} }, {}), undefined, "Paseo 0.15: no subscribe, keep the five-second reads");
  const calls: unknown[] = [];
  const contract = { name: "vitals.pulse-stream" };
  const client = {
    subscribe(this: unknown, c: unknown, input: unknown, onEvent: (p: unknown) => void, options: { onClosed(c: { error?: Error }): void }) {
      calls.push([this === client, c, input]);
      onEvent(pulse(5));
      options.onClosed({ error: new Error("x") });
      return Object.assign(() => { calls.push("released"); }, { ready: Promise.resolve() });
    },
  };
  const seen: unknown[] = [];
  const handle = pulseStreamOf(client, contract)!((p) => seen.push(p), (e) => seen.push(e?.message));
  handle.release();
  assert.deepEqual(calls, [[true, contract, {}], "released"]);
  assert.equal(seen.length, 2);
  assert.equal(seen[1], "x");
});
