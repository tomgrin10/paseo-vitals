import assert from "node:assert/strict";
import test from "node:test";

import { parseByteSize, parseMeminfo } from "./collect.ts";

test("parseByteSize handles Docker's binary units", () => {
  assert.equal(parseByteSize("341.2MiB"), 357_774_131);
  assert.equal(parseByteSize("3.929GiB"), 4_218_731_626);
  assert.equal(parseByteSize("0B"), 0);
  assert.equal(parseByteSize("not a size"), 0);
});

test("parseMeminfo exposes available, cache, anonymous, and swap usage", () => {
  const memory = parseMeminfo([
    "MemTotal:       1000000 kB",
    "MemFree:         100000 kB",
    "MemAvailable:    400000 kB",
    "Buffers:          10000 kB",
    "Cached:          200000 kB",
    "SReclaimable:     20000 kB",
    "AnonPages:       300000 kB",
    "Shmem:            10000 kB",
    "SwapTotal:       500000 kB",
    "SwapFree:        350000 kB",
  ].join("\n"));
  assert.equal(memory.usedBytes, 600_000 * 1024);
  assert.equal(memory.cacheBytes, 230_000 * 1024);
  assert.equal(memory.anonymousBytes, 310_000 * 1024);
  assert.equal(memory.swapUsedBytes, 150_000 * 1024);
});
