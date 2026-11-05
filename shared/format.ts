export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

export function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  // Non-breaking, so "15d 18h" never splits across lines.
  if (days > 0) return `${days}d\u00a0${hours}h`;
  if (hours > 0) return `${hours}h\u00a0${minutes}m`;
  return `${minutes}m`;
}

/** A percentage for reading: one decimal below 10, whole above; "–" before the first sample. */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "–";
  return `${value.toFixed(value >= 10 || value === 0 ? 0 : 1)}%`;
}

/** "just now", "12s ago", "3m ago". */
export function formatAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 3) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}
