const SENSITIVE = /(token|secret|password|authorization|card|signature|api[-_]?key|credential)/i;
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        SENSITIVE.test(k) ? "[redacted]" : redact(v, depth + 1),
      ]),
    );
  }
  return value;
}
