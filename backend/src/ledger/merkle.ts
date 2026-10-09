import { createHash } from 'crypto';

/**
 * Merkle tree for anchoring — the RFC 9162 (Certificate Transparency v2)
 * construction, specified in docs/SPEC_PHASE1.md §2:
 *
 *   leafHash(e)    = SHA256(0x00 ‖ e)          e = 32-byte event hash
 *   nodeHash(l, r) = SHA256(0x01 ‖ l ‖ r)
 *   MTH(D[0..n))   = nodeHash(MTH(D[0..k)), MTH(D[k..n)))   k = largest power of two < n
 *
 * The 0x00/0x01 prefixes stop an interior node from ever being presented as a
 * leaf (second-preimage attack). The browser verifier (frontend/src/lib/verify)
 * implements the same functions; docs/test-vectors/phase1.json pins both.
 */

const LEAF_PREFIX = Buffer.from([0x00]);
const NODE_PREFIX = Buffer.from([0x01]);

function sha256(...parts: Buffer[]): Buffer {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest();
}

function hexToBytes32(hex: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error(`merkle: expected 64 lowercase hex chars, got "${hex}"`);
  return Buffer.from(hex, 'hex');
}

export function leafHash(eventHashHex: string): string {
  return sha256(LEAF_PREFIX, hexToBytes32(eventHashHex)).toString('hex');
}

export function nodeHash(leftHex: string, rightHex: string): string {
  return sha256(NODE_PREFIX, hexToBytes32(leftHex), hexToBytes32(rightHex)).toString('hex');
}

/** Largest power of two strictly less than n (n ≥ 2). */
function splitPoint(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

export interface MerkleTree {
  root: string;
  size: number;
  /** proofs[i] = audit path for leaf i, deepest sibling first (RFC 9162 §2.1.3.1). */
  proofs: string[][];
}

/**
 * Builds the tree over event hashes (in the given order) and every leaf's
 * inclusion proof. Subtree hashes are memoised, so this is O(n log n) even
 * though each proof references large sibling subtrees.
 */
export function buildMerkleTree(eventHashes: string[]): MerkleTree {
  if (eventHashes.length === 0) throw new Error('merkle: cannot build a tree with no leaves');
  const leaves = eventHashes.map(leafHash);
  const memo = new Map<string, string>();

  const mth = (lo: number, hi: number): string => {
    const n = hi - lo;
    if (n === 1) return leaves[lo];
    const key = `${lo}:${hi}`;
    const cached = memo.get(key);
    if (cached) return cached;
    const k = splitPoint(n);
    const h = nodeHash(mth(lo, lo + k), mth(lo + k, hi));
    memo.set(key, h);
    return h;
  };

  const path = (m: number, lo: number, hi: number): string[] => {
    const n = hi - lo;
    if (n === 1) return [];
    const k = splitPoint(n);
    return m < k ? [...path(m, lo, lo + k), mth(lo + k, hi)] : [...path(m - k, lo + k, hi), mth(lo, lo + k)];
  };

  return {
    root: mth(0, leaves.length),
    size: leaves.length,
    proofs: leaves.map((_, i) => path(i, 0, leaves.length)),
  };
}

/** RFC 9162 §2.1.3.2 inclusion-proof verification. */
export function verifyInclusion(eventHashHex: string, leafIndex: number, treeSize: number, proof: string[], rootHex: string): boolean {
  if (!Number.isInteger(leafIndex) || !Number.isInteger(treeSize) || leafIndex < 0 || leafIndex >= treeSize) return false;
  let fn = leafIndex;
  let sn = treeSize - 1;
  let r = leafHash(eventHashHex);
  for (const p of proof) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = nodeHash(p, r);
      if (fn % 2 === 0) {
        do {
          fn >>= 1;
          sn >>= 1;
        } while (fn % 2 === 0 && fn !== 0);
      }
    } else {
      r = nodeHash(r, p);
    }
    fn >>= 1;
    sn >>= 1;
  }
  return sn === 0 && r === rootHex;
}
