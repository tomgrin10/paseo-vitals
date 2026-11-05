import assert from "node:assert/strict";
import test from "node:test";

import { compositionOf } from "../shared/composition.ts";
import { diskPercent, levelOf, pressureHeadline, pressureLabel, pressureOf } from "../shared/pressure.ts";

const GiB = 1024 ** 3;
const input = (ram: number, disk: number, swap = 0, swapTotal = 4 * GiB) => ({
  memory: { totalBytes: 100 * GiB, usedBytes: ram * GiB, swapTotalBytes: swapTotal, swapUsedBytes: (swap / 100) * swapTotal },
  disk: { usedBytes: disk * GiB, availableBytes: (100 - disk) * GiB },
});

test("levels: CPU warns but never turns critical; RAM and disk at 90/95", () => {
  assert.equal(levelOf("cpu", 100), "warning");
  assert.equal(levelOf("cpu", null), "ok");
  assert.equal(levelOf("ram", 89.4), "ok");
  assert.equal(levelOf("ram", 94.7), "critical", "shown as 95%, so judged as 95%");
  assert.equal(levelOf("ram", 90), "warning");
  assert.equal(levelOf("disk", 95), "critical");
});

test("a healthy host has no pressure and says so plainly", () => {
  const pressure = pressureOf(input(62, 48, 99));
  assert.deepEqual(pressure, { level: "ok", items: [] });
  assert.equal(pressureHeadline(pressure), "Running fine");
});

test("full swap alone is normal on Linux; it counts only while RAM is tight", () => {
  assert.equal(pressureOf(input(70, 10, 99)).level, "ok");
  const tight = pressureOf(input(91, 10, 99));
  assert.deepEqual(tight.items.map((item) => item.resource), ["swap", "ram"]);
  assert.equal(pressureHeadline(tight), "RAM is almost out");
});

test("labels and headlines name the worst resources first", () => {
  const both = pressureOf(input(94.6, 96.2));
  assert.equal(both.level, "critical");
  assert.equal(pressureLabel(both), "Disk 96% · RAM 95%");
  assert.equal(pressureHeadline(both), "Disk and RAM are almost out");
  assert.equal(pressureHeadline(pressureOf(input(91, 10, 0, 0))), "RAM is running low");
  assert.equal(pressureHeadline(pressureOf(input(92, 91))), "RAM and disk are running low");
  assert.equal(pressureLabel(pressureOf(input(99.7, 10, 0, 0))), "RAM 99%");
});

test("disk percent follows df: reserved blocks are neither used nor free", () => {
  assert.equal(diskPercent({ usedBytes: 90, availableBytes: 0 }), 100);
  assert.equal(diskPercent({ usedBytes: 0, availableBytes: 0 }), 0);
});

test("composition splits RAM in use and scales over-counted RSS to fit", () => {
  const base = { memory: { totalBytes: 32 * GiB, usedBytes: 20 * GiB } as never, docker: { available: true, memoryBytes: 4 * GiB } as never };
  const fits = compositionOf({ ...base, paseo: { agentsRssBytes: 10 * GiB, coreRssBytes: 2 * GiB } as never });
  assert.equal(fits.scaled, false);
  assert.deepEqual(fits.segments.map((s) => s.bytes / GiB), [10, 2, 4, 4]);
  const over = compositionOf({ ...base, paseo: { agentsRssBytes: 30 * GiB, coreRssBytes: 6 * GiB } as never });
  assert.equal(over.scaled, true);
  assert.equal(over.segments.reduce((sum, s) => sum + s.bytes, 0), 20 * GiB);
  assert.equal(over.segments.at(-1)!.bytes, 0);
  const noDocker = compositionOf({ ...base, docker: { available: false, memoryBytes: 9 * GiB } as never, paseo: { agentsRssBytes: GiB, coreRssBytes: GiB } as never });
  assert.equal(noDocker.segments.find((s) => s.key === "docker")!.bytes, 0);
});
