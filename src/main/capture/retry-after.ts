export function parseRetryAfter(
  value: string | null,
  now = Date.now(),
): number {
  if (!value) return 0;
  const milliseconds = /^\d+$/.test(value.trim())
    ? Number(value) * 1000
    : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : 0;
}
