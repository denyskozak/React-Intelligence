const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|credit|card|cvv|email|phone|address|api[-_]?key/i;

export function scrubPayload(value: unknown, key = "", depth = 0, seen = new WeakSet<object>()): unknown {
  if (SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.slice(0, 2000);
  if (typeof value !== "object") return String(value);
  if (depth >= 5) return "[MAX_DEPTH]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrubPayload(item, key, depth + 1, seen));
  return Object.fromEntries(Object.entries(value).slice(0, 50).map(([childKey, child]) => [childKey, scrubPayload(child, childKey, depth + 1, seen)]));
}
