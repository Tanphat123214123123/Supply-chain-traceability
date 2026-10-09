/**
 * The browser verifier's own hashing — deliberately NOT shared with any
 * server code, so a bug (or a backdoor) on the server side can't make both
 * agree. Implements docs/SPEC_PHASE1.md exactly; checked against
 * docs/test-vectors/phase1.json in verify.test.ts.
 */

/** RFC 8785 JSON Canonicalization Scheme. */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canonicalize: non-finite number')
      return JSON.stringify(value)
    case 'string':
      return JSON.stringify(value)
    case 'object':
      break
    default:
      throw new TypeError(`canonicalize: unsupported ${typeof value}`)
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalize(v === undefined ? null : v)).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle
  if (!s) throw new Error('Trình duyệt không hỗ trợ Web Crypto (cần HTTPS hoặc localhost).')
  return s
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) throw new Error('invalid hex')
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Bytes(...parts: Uint8Array[]): Promise<Uint8Array> {
  const total = parts.reduce((n, p) => n + p.length, 0)
  const buf = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    buf.set(p, offset)
    offset += p.length
  }
  return new Uint8Array(await subtle().digest('SHA-256', buf))
}

export async function sha256Text(text: string): Promise<string> {
  return bytesToHex(await sha256Bytes(new TextEncoder().encode(text)))
}

// ── Event hashes ────────────────────────────────────────────────────────────

export interface EventLink {
  lotId: string
  quantity: number
  unit: string
  headHash: string
  eventCount: number
}

export interface EnvelopeV3 {
  v: 3
  batchId: string
  sequenceNumber: number
  prevHash: string
  stage: string
  kind: string
  timestamp: string
  links: EventLink[]
}

export interface DisclosureV3 {
  envelope: EnvelopeV3
  disclosed: Array<{ name: string; value: unknown; salt: string }>
  hidden: string[]
}

export function claimCommitment(name: string, value: unknown, salt: string): Promise<string> {
  return sha256Text(canonicalize({ name, salt, value }))
}

/** SPEC §1.1: SHA256(JCS(envelope + sorted claim commitments)). */
export async function hashOfDisclosure(d: DisclosureV3): Promise<string> {
  const opened = await Promise.all(d.disclosed.map((c) => claimCommitment(c.name, c.value, c.salt)))
  const claims = [...opened, ...d.hidden].sort()
  return sha256Text(canonicalize({ ...d.envelope, claims }))
}

export interface ContentV2 {
  actorId: string
  location: string
  notes: string | null
  data: Record<string, unknown>
  salt: string
}

/** v2 preimage (docs/DATABASE.md) — whole event + salt. */
export function hashV2(
  e: { batchId: string; sequenceNumber: number; prevHash: string; stage: string; timestamp: string },
  c: ContentV2,
): Promise<string> {
  return sha256Text(
    canonicalize({
      v: 2,
      salt: c.salt,
      batchId: e.batchId,
      sequenceNumber: e.sequenceNumber,
      prevHash: e.prevHash,
      stage: e.stage,
      actorId: c.actorId,
      timestamp: e.timestamp,
      location: c.location,
      notes: c.notes,
      data: c.data,
    }),
  )
}

// ── Merkle (RFC 9162 structure, SPEC §2) ────────────────────────────────────

const LEAF = new Uint8Array([0])
const NODE = new Uint8Array([1])

export async function leafHash(eventHashHex: string): Promise<string> {
  return bytesToHex(await sha256Bytes(LEAF, hexToBytes(eventHashHex)))
}

export async function nodeHash(left: string, right: string): Promise<string> {
  return bytesToHex(await sha256Bytes(NODE, hexToBytes(left), hexToBytes(right)))
}

/** RFC 9162 §2.1.3.2 — true iff `eventHash` sits at `leafIndex` of a `treeSize`-leaf tree with this root. */
export async function verifyInclusion(
  eventHashHex: string,
  leafIndex: number,
  treeSize: number,
  proof: string[],
  rootHex: string,
): Promise<boolean> {
  if (!Number.isInteger(leafIndex) || !Number.isInteger(treeSize) || leafIndex < 0 || leafIndex >= treeSize) return false
  let fn = leafIndex
  let sn = treeSize - 1
  let r = await leafHash(eventHashHex)
  for (const p of proof) {
    if (sn === 0) return false
    if (fn % 2 === 1 || fn === sn) {
      r = await nodeHash(p, r)
      if (fn % 2 === 0) {
        do {
          fn >>= 1
          sn >>= 1
        } while (fn % 2 === 0 && fn !== 0)
      }
    } else {
      r = await nodeHash(r, p)
    }
    fn >>= 1
    sn >>= 1
  }
  return sn === 0 && r === rootHex
}
