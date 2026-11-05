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
