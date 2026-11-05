import assert from "node:assert/strict";
import test from "node:test";

import { PULSE_HISTORY, PULSE_IDLE_MS, PULSE_INTERVAL_MS, createPulse } from "../server/pulse.ts";
import { treeOf } from "../server/collect.ts";

function fakeClock() {
  let now = 1_000_000;
  let fn: (() => void) | null = null;
  return {
    clock: { now: () => now, setInterval: (f: () => void) => { fn = f; return 1; }, clearInterval: () => { fn = null; } },
    advance: async (ms: number) => { now += ms; fn?.(); await new Promise((resolve) => setImmediate(resolve)); },
    active: () => fn !== null,
  };
}

function fakeSource() {
  let ticks = 0;
  const calls = { cpu: 0, memory: 0, disk: 0 };
  return {
    calls,
    source: {
      async cpu() { calls.cpu += 1; ticks += 100; return { totalTicks: ticks, idleTicks: ticks * 0.75 }; },
      async memory() { calls.memory += 1; return { totalBytes: 100, usedBytes: 40, availableBytes: 60, freeBytes: 50, cacheBytes: 10, anonymousBytes: 30, swapTotalBytes: 10, swapUsedBytes: 5 }; },
      async disk() { calls.disk += 1; return { path: "/", totalBytes: 100, usedBytes: 50, availableBytes: 50, usedPercent: 50 }; },
    },
  };
}

test("the pulse sampler starts on the first read and nothing runs before it", async () => {
  const time = fakeClock();
  const { source, calls } = fakeSource();
  const pulse = createPulse(source, time.clock);
  assert.equal(time.active(), false);
  assert.equal(calls.cpu, 0);
  const first = await pulse.read();
  assert.equal(time.active(), true);
  assert.equal(first.cpuPercent, null, "one CPU sample is a baseline, not a reading");
  await time.advance(PULSE_INTERVAL_MS);
  const second = await pulse.read();
  assert.equal(second.cpuPercent, 25);
  assert.equal(second.history.length, 2);
  assert.equal(second.history[1]!.memoryPercent, 40);
  assert.equal(second.history[1]!.swapPercent, 50);
});

test("history is capped and disk is read at most every 30 seconds", async () => {
  const time = fakeClock();
  const { source, calls } = fakeSource();
  const pulse = createPulse(source, time.clock);
  await pulse.read();
  for (let i = 0; i < PULSE_HISTORY + 10; i += 1) {
    await time.advance(PULSE_INTERVAL_MS);
    if (i % 6 === 0) await pulse.read();
  }
  const out = await pulse.read();
  assert.equal(out.history.length, PULSE_HISTORY);
  assert.ok(calls.disk <= Math.ceil(((PULSE_HISTORY + 11) * PULSE_INTERVAL_MS) / 30_000) + 1);
});

test("the sampler stops and forgets a minute after the last read", async () => {
  const time = fakeClock();
  const { source, calls } = fakeSource();
  const pulse = createPulse(source, time.clock);
  await pulse.read();
  await time.advance(PULSE_IDLE_MS + 1);
  assert.equal(time.active(), false);
  const before = calls.cpu;
  await time.advance(PULSE_INTERVAL_MS);
  assert.equal(calls.cpu, before);
  const again = await pulse.read();
  assert.equal(again.history.length, 1);
  pulse.stop();
  assert.equal(time.active(), false);
});

test("an agent's processes come back as a tree, biggest branches first, capped", () => {
  const rows = [
    { pid: 10, ppid: 1, name: "claude", rssBytes: 500, cpuPercent: 3 },
    { pid: 11, ppid: 10, name: "node", rssBytes: 100, cpuPercent: 1 },
    { pid: 12, ppid: 10, name: "bash", rssBytes: 300, cpuPercent: 0 },
    { pid: 13, ppid: 12, name: "npm", rssBytes: 50, cpuPercent: null },
    { pid: 20, ppid: 2, name: "mcp", rssBytes: 900, cpuPercent: 0 },
  ];
  const { processes, hiddenCount } = treeOf(rows);
  assert.deepEqual(processes.map((p) => [p.name, p.depth]), [["mcp", 0], ["claude", 0], ["bash", 1], ["npm", 2], ["node", 1]]);
  assert.equal(hiddenCount, 0);
  const capped = treeOf(rows, 2);
  assert.equal(capped.processes.length, 2);
  assert.equal(capped.hiddenCount, 3);
});
