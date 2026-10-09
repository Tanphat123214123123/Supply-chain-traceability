import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { canonicalize, claimCommitment, hashOfDisclosure, verifyInclusion } from './crypto'
import { anchorChainConfig, type AnchorReader } from './chain'
import { verifyBatch, type VerificationPayload } from './verifyBatch'

const vectors = JSON.parse(readFileSync(resolve(__dirname, '../../../../docs/test-vectors/phase1.json'), 'utf8'))

describe('browser crypto agrees with the published spec vectors', () => {
  it('JCS', () => {
    expect(canonicalize(vectors.jcsExample.input)).toBe(vectors.jcsExample.canonical)
  })

  it('hash v3 claim commitments and disclosures', async () => {
    for (const c of vectors.hashV3) {
      for (const [name, commitment] of Object.entries(c.commitments)) {
        const value = name.startsWith('data.') ? c.event.data[name.slice(5)] : c.event[name]
        expect(await claimCommitment(name, value, c.claimSalts[name])).toBe(commitment)
      }
      expect(await hashOfDisclosure(c.publicDisclosure)).toBe(c.hash)
    }
  })

  it('Merkle inclusion proofs', async () => {
    for (const c of vectors.merkle) {
      for (let i = 0; i < c.leaves.length; i++) {
        expect(await verifyInclusion(c.leaves[i], i, c.leaves.length, c.proofs[i], c.root)).toBe(true)
        if (c.leaves.length > 1) {
          expect(await verifyInclusion(c.leaves[i], (i + 1) % c.leaves.length, c.leaves.length, c.proofs[i], c.root)).toBe(false)
        }
      }
    }
  })
})

// ── verifyBatch ─────────────────────────────────────────────────────────────

const harvest = vectors.hashV3[0]
const CONTRACT = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

/** A one-event batch built from the spec vectors, anchored in a 1-leaf tree. */
function payload(): VerificationPayload {
  const d = harvest.publicDisclosure
  return {
    access: 'public',
    batch: { id: d.envelope.batchId, productName: 'Cà phê', headHash: harvest.hash, eventCount: 1 },
    events: [
      {
        id: 'e1',
        sequenceNumber: 0,
        stage: d.envelope.stage,
        kind: d.envelope.kind,
        timestamp: d.envelope.timestamp,
        hash: harvest.hash,
        prevHash: d.envelope.prevHash,
        hashVersion: 3,
        links: [],
        disclosure: structuredClone(d),
      },
    ],
  }
}

async function anchored(p: VerificationPayload, root?: string): Promise<VerificationPayload> {
  // In a 1-leaf tree the root is leafHash(eventHash) and the proof is empty.
  const { leafHash } = await import('./crypto')
  p.events[0].anchor = {
    leafIndex: 0,
    proof: [],
    anchor: { root: root ?? (await leafHash(p.events[0].hash)), leafCount: 1, status: 'confirmed', chainId: 31337, contractAddress: CONTRACT, txHash: '0xabc' },
  }
  return p
}

const readerWith = (roots: string[]): AnchorReader => ({
  getAnchor: async (root) => (roots.includes(root) ? { timestamp: new Date('2026-10-01T00:00:00Z'), blockNumber: 7 } : null),
})

describe('verifyBatch', () => {
  it('verified: content recomputes, chain complete, root confirmed by the contract', async () => {
    const p = await anchored(payload())
    const v = await verifyBatch(p, { reader: readerWith([p.events[0].anchor!.anchor.root]), trustedContract: CONTRACT, trustedChainId: 31337 })
    expect(v.overall).toBe('verified')
    expect(v.events[0]).toMatchObject({ content: 'ok', linked: true, anchor: 'anchored', blockNumber: 7, hiddenFieldCount: 3 })
    expect(v.events[0].fields.map((f) => f.name).sort()).toEqual(['data.cultivation', 'data.harvestDate', 'data.variety', 'location'])
  })

  it('partially verified while not yet anchored', async () => {
    const v = await verifyBatch(payload(), { reader: readerWith([]) })
    expect(v.overall).toBe('partially-verified')
    expect(v.events[0]).toMatchObject({ content: 'ok', anchor: 'pending' })
  })

  it('fails when a shown value was altered', async () => {
    const p = payload()
    p.events[0].disclosure!.disclosed[0].value = 'Nơi khác'
    const v = await verifyBatch(p, { reader: null })
    expect(v.overall).toBe('failed')
    expect(v.events[0].content).toBe('mismatch')
  })

  it('fails when the server claims "confirmed" but the contract has no such root', async () => {
    const p = await anchored(payload())
    const v = await verifyBatch(p, { reader: readerWith([]), trustedContract: CONTRACT })
    expect(v.overall).toBe('failed')
    expect(v.events[0].anchor).toBe('mismatch')
  })

  it('fails on a forged root (proof does not lead to it), even if that root is on-chain', async () => {
    const forged = 'f'.repeat(64)
    const p = await anchored(payload(), forged)
    const v = await verifyBatch(p, { reader: readerWith([forged]), trustedContract: CONTRACT })
    expect(v.events[0].anchor).toBe('mismatch')
    expect(v.overall).toBe('failed')
  })

  it('rejects proofs that point at a contract other than the one this build trusts', async () => {
    const p = await anchored(payload())
    p.events[0].anchor!.anchor.contractAddress = '0x000000000000000000000000000000000000dEaD'
    const v = await verifyBatch(p, { reader: readerWith([p.events[0].anchor!.anchor.root]), trustedContract: CONTRACT })
    expect(v.events[0].anchor).toBe('mismatch')
  })

  it('detects a truncated chain via the recorded head', async () => {
    const p = payload()
    p.batch.eventCount = 2
    const v = await verifyBatch(p, { reader: null })
    expect(v.complete).toBe(false)
    expect(v.overall).toBe('failed')
  })

  it('an unreachable chain is reported, not mistaken for tampering', async () => {
    const p = await anchored(payload())
    const v = await verifyBatch(p, { reader: { getAnchor: async () => Promise.reject(new Error('down')) }, trustedContract: CONTRACT })
    expect(v.events[0].anchor).toBe('unchecked')
    expect(v.overall).toBe('partially-verified')
    expect(v.problems.join(' ')).toMatch(/Không kết nối được blockchain/)
  })
})

describe('anchorChainConfig', () => {
  it('needs chain id, contract and at least one RPC', () => {
    expect(anchorChainConfig({})).toBeNull()
    expect(
      anchorChainConfig({ VITE_ANCHOR_CHAIN_ID: '84532', VITE_ANCHOR_CONTRACT: CONTRACT, VITE_ANCHOR_RPC_URLS: 'https://a, https://b' }),
    ).toEqual({ chainId: 84532, contractAddress: CONTRACT, rpcUrls: ['https://a', 'https://b'], explorerUrl: undefined })
    expect(anchorChainConfig({ VITE_ANCHOR_CHAIN_ID: '1', VITE_ANCHOR_CONTRACT: 'nope', VITE_ANCHOR_RPC_URLS: 'x' })).toBeNull()
  })
})
