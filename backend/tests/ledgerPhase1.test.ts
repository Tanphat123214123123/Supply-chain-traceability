import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { canonicalize } from '../src/ledger/canonicalJson';
import {
  claimCommitment,
  computeEventHashV3,
  discloseV3,
  eventClaims,
  GENESIS_HASH,
  HashableEvent,
  hashOfDisclosure,
  newClaimSalts,
  publicClaimNames,
  recomputeEventHash,
} from '../src/ledger/hashChain';
import { buildMerkleTree, leafHash, nodeHash, verifyInclusion } from '../src/ledger/merkle';
import { TraceEvent } from '../src/domain/types';

const vectors = JSON.parse(readFileSync(join(__dirname, '..', '..', 'docs', 'test-vectors', 'phase1.json'), 'utf8'));
const h = (s: string) => createHash('sha256').update(s).digest('hex');

function event(overrides: Partial<HashableEvent> = {}): HashableEvent {
  return {
    batchId: '6f1c1f9e-2a8d-4a43-9d3f-6f0b1f2a3c4d',
    sequenceNumber: 0,
    prevHash: GENESIS_HASH,
    stage: 'HARVEST',
    kind: 'OBSERVE',
    links: [],
    actorId: '0d6c3a51-9b1e-4a11-8f5a-1c2d3e4f5a6b',
    timestamp: new Date('2026-10-01T00:00:00.000Z'),
    location: 'Đà Lạt',
    notes: 'nội bộ',
    data: { variety: 'Robusta', moisture: 13 },
    ...overrides,
  };
}

describe('hash v3 (selective disclosure) — SPEC §1.1', () => {
  it('reproduces the published test vectors exactly', () => {
    for (const c of vectors.hashV3) {
      const e: HashableEvent = { ...c.event, timestamp: new Date(c.event.timestamp) };
      expect(computeEventHashV3(e, c.claimSalts)).toBe(c.hash);
      for (const claim of eventClaims(e)) {
        expect(claimCommitment(claim.name, claim.value, c.claimSalts[claim.name])).toBe(c.commitments[claim.name]);
      }
      expect(hashOfDisclosure(c.publicDisclosure)).toBe(c.hash);
      const visible = publicClaimNames(e.stage);
      expect(discloseV3(e, c.claimSalts, (n) => visible.has(n))).toEqual(c.publicDisclosure);
    }
    expect(canonicalize(vectors.jcsExample.input)).toBe(vectors.jcsExample.canonical);
  });

  it('commits one claim per present field; empty notes and absent data produce none', () => {
    expect(eventClaims(event()).map((c) => c.name)).toEqual(['actorId', 'location', 'notes', 'data.moisture', 'data.variety']);
    expect(eventClaims(event({ notes: undefined, data: {} })).map((c) => c.name)).toEqual(['actorId', 'location']);
  });

  it('any opened or hidden field change, and any envelope change, alters the hash', () => {
    const salts = newClaimSalts(event());
    const reference = computeEventHashV3(event(), salts);
    const variants: Partial<HashableEvent>[] = [
      { location: 'Bảo Lộc' },
      { notes: 'khác' },
      { data: { variety: 'Robusta', moisture: 14 } },
      { actorId: '00000000-0000-4000-8000-000000000000' },
      { sequenceNumber: 1 },
      { prevHash: 'f'.repeat(64) },
      { stage: 'PROCESSING' },
      { kind: 'MERGE' },
      { timestamp: new Date('2026-10-01T00:00:00.001Z') },
    ];
    for (const v of variants) expect(computeEventHashV3(event(v), salts)).not.toBe(reference);
  });

  it('a disclosure that lies about an opened value no longer matches', () => {
    const salts = newClaimSalts(event());
    const hash = computeEventHashV3(event(), salts);
    const d = discloseV3(event(), salts, (n) => n === 'location' || n === 'data.variety');
    expect(hashOfDisclosure(d)).toBe(hash);
    expect(d.hidden).toHaveLength(3);
    const lie = { ...d, disclosed: d.disclosed.map((c) => (c.name === 'location' ? { ...c, value: 'Nơi khác' } : c)) };
    expect(hashOfDisclosure(lie)).not.toBe(hash);
    const dropped = { ...d, hidden: d.hidden.slice(1) };
    expect(hashOfDisclosure(dropped)).not.toBe(hash);
  });

  it('hidden commitments are sorted, so their order reveals nothing and does not matter', () => {
    const salts = newClaimSalts(event());
    const d = discloseV3(event(), salts, () => false);
    expect(d.hidden).toEqual([...d.hidden].sort());
    expect(hashOfDisclosure({ ...d, hidden: [...d.hidden].reverse() })).toBe(computeEventHashV3(event(), salts));
  });

  it('link order does not matter, but every link field is committed', () => {
    const a = { lotId: 'a0000000-0000-4000-8000-000000000001', quantity: 1, unit: 'kg', headHash: 'a'.repeat(64), eventCount: 1 };
    const b = { lotId: 'b0000000-0000-4000-8000-000000000002', quantity: 2, unit: 'kg', headHash: 'b'.repeat(64), eventCount: 2 };
    const salts = newClaimSalts(event());
    const ab = computeEventHashV3(event({ kind: 'MERGE', links: [a, b] }), salts);
    expect(computeEventHashV3(event({ kind: 'MERGE', links: [b, a] }), salts)).toBe(ab);
    expect(computeEventHashV3(event({ kind: 'MERGE', links: [a, { ...b, headHash: 'c'.repeat(64) }] }), salts)).not.toBe(ab);
    expect(computeEventHashV3(event({ kind: 'MERGE', links: [a, { ...b, quantity: 3 }] }), salts)).not.toBe(ab);
  });

  it('cannot be recomputed when a claim salt is missing (e.g. a field was added afterwards)', () => {
    const salts = newClaimSalts(event());
    const stored = { ...event(), id: 'x', tenantId: 't', hash: computeEventHashV3(event(), salts), hashVersion: 3, claimSalts: salts } as TraceEvent;
    expect(recomputeEventHash(stored)).toBe(stored.hash);
    expect(recomputeEventHash({ ...stored, data: { ...stored.data, injected: 1 } })).toBeNull();
  });
});

describe('Merkle tree — SPEC §2 (RFC 9162 structure)', () => {
  const leaves = Array.from({ length: 40 }, (_, i) => h(`event-${i}`));
  const L = (i: number) => leafHash(leaves[i]);

  it('uses the 0x00 leaf / 0x01 node prefixes', () => {
    const leafBytes = Buffer.concat([Buffer.from([0]), Buffer.from(leaves[0], 'hex')]);
    expect(L(0)).toBe(createHash('sha256').update(leafBytes).digest('hex'));
    const nodeBytes = Buffer.concat([Buffer.from([1]), Buffer.from(L(0), 'hex'), Buffer.from(L(1), 'hex')]);
    expect(nodeHash(L(0), L(1))).toBe(createHash('sha256').update(nodeBytes).digest('hex'));
  });

  it('splits at the largest power of two below n, exactly as RFC 9162', () => {
    expect(buildMerkleTree(leaves.slice(0, 1)).root).toBe(L(0));
    expect(buildMerkleTree(leaves.slice(0, 3)).root).toBe(nodeHash(nodeHash(L(0), L(1)), L(2)));
    expect(buildMerkleTree(leaves.slice(0, 5)).root).toBe(nodeHash(nodeHash(nodeHash(L(0), L(1)), nodeHash(L(2), L(3))), L(4)));
    expect(buildMerkleTree(leaves.slice(0, 7)).root).toBe(
      nodeHash(nodeHash(nodeHash(L(0), L(1)), nodeHash(L(2), L(3))), nodeHash(nodeHash(L(4), L(5)), L(6))),
    );
  });

  it('every proof of every tree size 1..40 verifies, and only against its own leaf, index and root', () => {
    for (let n = 1; n <= leaves.length; n++) {
      const tree = buildMerkleTree(leaves.slice(0, n));
      for (let i = 0; i < n; i++) {
        expect(verifyInclusion(leaves[i], i, n, tree.proofs[i], tree.root)).toBe(true);
        if (n > 1) {
          expect(verifyInclusion(leaves[(i + 1) % n], i, n, tree.proofs[i], tree.root)).toBe(false);
          expect(verifyInclusion(leaves[i], (i + 1) % n, n, tree.proofs[i], tree.root)).toBe(false);
        }
        expect(verifyInclusion(leaves[i], i, n, tree.proofs[i], h('another root'))).toBe(false);
      }
    }
  });

  it('rejects truncated, padded or out-of-range proofs', () => {
    const tree = buildMerkleTree(leaves.slice(0, 13));
    expect(verifyInclusion(leaves[5], 5, 13, tree.proofs[5].slice(1), tree.root)).toBe(false);
    expect(verifyInclusion(leaves[5], 5, 13, [...tree.proofs[5], L(0)], tree.root)).toBe(false);
    expect(verifyInclusion(leaves[5], 13, 13, tree.proofs[5], tree.root)).toBe(false);
    expect(verifyInclusion(leaves[5], -1, 13, tree.proofs[5], tree.root)).toBe(false);
  });

  it('reproduces the published Merkle vectors', () => {
    for (const c of vectors.merkle) {
      const tree = buildMerkleTree(c.leaves);
      expect(tree.root).toBe(c.root);
      expect(tree.proofs).toEqual(c.proofs);
    }
  });

  it('refuses an empty tree', () => {
    expect(() => buildMerkleTree([])).toThrow();
  });
});
