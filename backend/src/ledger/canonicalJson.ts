/**
 * RFC 8785 — JSON Canonicalization Scheme (JCS).
 *
 * The event hash must be recomputable by anyone, in any language, from the
 * event's JSON alone. Plain JSON.stringify isn't enough for that: key order
 * follows insertion order, which differs between producers. JCS fixes it:
 *   • object keys sorted by their UTF-16 code units (what JS string compare does);
 *   • numbers in the ECMAScript shortest round-trip form (what JS already emits);
 *   • strings escaped exactly as JSON.stringify does;
 *   • no insignificant whitespace.
 * Off-the-shelf JCS libraries exist for Go, Python, Java, Rust, .NET — so a
 * third-party verifier never has to reimplement this by hand.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, '$');
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError(`canonicalize: non-finite number at ${path}`);
      // ES2015+ Number→string is exactly the JCS-mandated form (and -0 → "0").
      return JSON.stringify(value);
    case 'string':
      return JSON.stringify(value);
    case 'object':
      break;
    default:
      throw new TypeError(`canonicalize: unsupported ${typeof value} at ${path}`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, i) => serialize(item === undefined ? null : item, `${path}[${i}]`)).join(',')}]`;
  }

  if (value instanceof Date) {
    throw new TypeError(`canonicalize: Date at ${path} — convert to an ISO string explicitly first`);
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`canonicalize: only plain objects are allowed (at ${path})`);
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v, `${path}.${k}`)}`).join(',')}}`;
}
