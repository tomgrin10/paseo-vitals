import assert from "node:assert/strict";
import test from "node:test";

import {
  parseByteSize,
  parseCpuTime,
  parseMeminfo,
  parsePsAgentIds,
  parsePsProcesses,
  parseVmStat,
} from "./collect.ts";

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

test("parseVmStat matches Activity Monitor's used and cached memory", () => {
  const page = 16384;
  const memory = parseVmStat([
    "Mach Virtual Memory Statistics: (page size of 16384 bytes)",
    "Pages free:                                1000.",
    "Pages wired down:                          2000.",
    "Pages purgeable:                            500.",
    "File-backed pages:                         4000.",
    "Anonymous pages:                          10000.",
    "Pages occupied by compressor:              1500.",
    "\"Translation faults\":                  99999.",
  ].join("\n"), 64 * 1024 ** 3, "total = 2048.00M  used = 512.50M  free = 1535.50M  (encrypted)");
  assert.equal(memory.anonymousBytes, 9500 * page);
  assert.equal(memory.usedBytes, 13_000 * page);
  assert.equal(memory.availableBytes, 64 * 1024 ** 3 - 13_000 * page);
  assert.equal(memory.cacheBytes, 4500 * page);
  assert.equal(memory.freeBytes, 1000 * page);
  assert.equal(memory.swapTotalBytes, 2048 * 1024 ** 2);
  assert.equal(memory.swapUsedBytes, 512.5 * 1024 ** 2);
});

test("parseCpuTime handles ps time formats", () => {
  assert.equal(parseCpuTime("0:01.23"), 123);
  assert.equal(parseCpuTime("125:00.50"), 750_050);
  assert.equal(parseCpuTime("1-02:03:04"), 9_378_400);
  assert.equal(parseCpuTime("bogus"), 0);
});

test("parsePsProcesses reads macOS ps rows with spaced executable paths", () => {
  const rows = parsePsProcesses([
    "  1     0   9216   0:30.10 /sbin/launchd",
    "38235   1 786636  12:01.00 /Applications/Paseo.app/Contents/MacOS/Paseo Helper",
  ].join("\n"));
  assert.deepEqual(rows[1], {
    pid: 38235,
    ppid: 1,
    name: "Paseo Helper",
    rssBytes: 786_636 * 1024,
    cpuTicks: 72_100,
    agentId: null,
  });
});

test("parsePsAgentIds keeps only the agent ID from ps -E output", () => {
  const ids = parsePsAgentIds([
    "  101 node agent.js HOME=/Users/me PASEO_AGENT_ID=abc-123 SECRET=x",
    "  102 node other.js HOME=/Users/me",
  ].join("\n"));
  assert.deepEqual([...ids], [[101, "abc-123"]]);
});
