import { ContentV2, DisclosureV3, EventLink, hashOfDisclosure, hashV2, verifyInclusion } from './crypto'
import type { AnchorReader } from './chain'

const GENESIS = '0'.repeat(64)

/** What GET /api/trace/public/:id/full returns (backend VerificationPayload). */
export interface VerificationPayload {
  access: 'public' | 'full'
  expiresAt?: string
  batch: { id: string; productName: string; headHash: string; eventCount: number }
  events: Array<{
    id: string
    sequenceNumber: number
    stage: string
    kind: string
    timestamp: string
    hash: string
    prevHash: string
    hashVersion: 1 | 2 | 3
    links: EventLink[]
    disclosure?: DisclosureV3
    contentV2?: ContentV2
    anchor?: {
      leafIndex: number
      proof: string[]
      anchor: {
        root: string
        leafCount: number
        status: 'built' | 'submitted' | 'confirmed'
        chainId: number
        contractAddress: string
        txHash?: string
        blockNumber?: number
        anchoredAt?: string
      }
    }
  }>
}

/** Per-event outcome, all computed in this browser. */
export interface EventVerdict {
  id: string
  sequenceNumber: number
  stage: string
  /** 'ok' = recomputed from the data shown; 'mismatch' = the data doesn't produce the hash; 'opaque' = no data to recompute from (v1/v2 without a link). */
  content: 'ok' | 'mismatch' | 'opaque'
  /** prevHash equals the previous event's hash (and sequence numbers are contiguous). */
  linked: boolean
  /**
   * 'anchored' = proof leads to a root the contract confirms;
   * 'pending'  = not sealed on-chain yet;
   * 'mismatch' = proof invalid, or the root is not on the contract / on another contract;
   * 'unchecked' = no chain configured or the RPC could not be reached.
   */
  anchor: 'anchored' | 'pending' | 'mismatch' | 'unchecked'
  anchoredAt?: Date
  blockNumber?: number
  txHash?: string
  /** Fields this browser saw and checked — only what the access level discloses. */
  fields: Array<{ name: string; value: unknown }>
  hiddenFieldCount: number
}

export type OverallVerdict =
  /** Every event recomputed or anchored; chain intact and complete. */
  | 'verified'
  /** Nothing contradicts the record, but some events aren't sealed on-chain yet (or the chain was unreachable). */
  | 'partially-verified'
  /** Something does not add up. */
  | 'failed'

export interface BatchVerdict {
  overall: OverallVerdict
  events: EventVerdict[]
  /** Last event hash equals the batch's recorded head and the count matches — no deleted tail. */
  complete: boolean
  problems: string[]
}

export interface VerifyOptions {
  reader: AnchorReader | null
  /** Contract the build trusts; a proof pointing at any other address is rejected. */
  trustedContract?: string
  trustedChainId?: number
}

export async function verifyBatch(payload: VerificationPayload, opts: VerifyOptions): Promise<BatchVerdict> {
  const problems: string[] = []
  const events: EventVerdict[] = []
  const rootCache = new Map<string, Promise<{ timestamp: Date; blockNumber: number } | null>>()
  let chainUnreachable = false

  let expectedPrev = GENESIS
  for (const [i, e] of payload.events.entries()) {
    const linked = e.prevHash === expectedPrev && e.sequenceNumber === i
    if (!linked) problems.push(`Sự kiện #${i + 1} không nối đúng với sự kiện trước`)
    expectedPrev = e.hash

    // 1. Content: recompute the hash from whatever this access level shows.
    let content: EventVerdict['content'] = 'opaque'
    let fields: EventVerdict['fields'] = []
    let hiddenFieldCount = 0
    if (e.disclosure) {
      const d = e.disclosure
      const envelopeMatches =
        d.envelope.batchId === payload.batch.id &&
        d.envelope.sequenceNumber === e.sequenceNumber &&
        d.envelope.prevHash === e.prevHash &&
        d.envelope.stage === e.stage &&
        d.envelope.kind === e.kind
      content = envelopeMatches && (await hashOfDisclosure(d)) === e.hash ? 'ok' : 'mismatch'
      fields = d.disclosed.map(({ name, value }) => ({ name, value }))
      hiddenFieldCount = d.hidden.length
    } else if (e.contentV2) {
      content =
        (await hashV2(
          { batchId: payload.batch.id, sequenceNumber: e.sequenceNumber, prevHash: e.prevHash, stage: e.stage, timestamp: e.timestamp },
          e.contentV2,
        )) === e.hash
          ? 'ok'
          : 'mismatch'
      fields = [
        { name: 'location', value: e.contentV2.location },
        ...Object.entries(e.contentV2.data).map(([k, v]) => ({ name: `data.${k}`, value: v })),
      ]
    }
    if (content === 'mismatch') problems.push(`Dữ liệu sự kiện #${i + 1} không khớp với mã băm đã ghi`)

    // 2. Anchor: proof → root, then ask the contract directly.
    let anchor: EventVerdict['anchor'] = 'pending'
    let anchoredAt: Date | undefined
    let blockNumber: number | undefined
    const a = e.anchor
    if (a && a.anchor.status !== 'built') {
      const proofOk = await verifyInclusion(e.hash, a.leafIndex, a.anchor.leafCount, a.proof, a.anchor.root)
      const sameContract =
        !opts.trustedContract ||
        (a.anchor.contractAddress.toLowerCase() === opts.trustedContract.toLowerCase() &&
          (opts.trustedChainId === undefined || a.anchor.chainId === opts.trustedChainId))
      if (!proofOk || !sameContract) {
        anchor = 'mismatch'
        problems.push(`Bằng chứng neo của sự kiện #${i + 1} không hợp lệ`)
      } else if (!opts.reader) {
        anchor = 'unchecked'
      } else {
        let lookup = rootCache.get(a.anchor.root)
        if (!lookup) {
          lookup = opts.reader.getAnchor(a.anchor.root)
          rootCache.set(a.anchor.root, lookup)
        }
        try {
          const onChain = await lookup
          if (onChain) {
            anchor = 'anchored'
            anchoredAt = onChain.timestamp
            blockNumber = onChain.blockNumber
          } else if (a.anchor.status === 'confirmed') {
            anchor = 'mismatch'
            problems.push(`Root của sự kiện #${i + 1} không có trên hợp đồng dù máy chủ báo đã neo`)
          }
        } catch {
          anchor = 'unchecked'
          chainUnreachable = true
        }
      }
    }

    events.push({
      id: e.id,
      sequenceNumber: e.sequenceNumber,
      stage: e.stage,
      content,
      linked,
      anchor,
      anchoredAt,
      blockNumber,
      txHash: a?.anchor.txHash,
      fields,
      hiddenFieldCount,
    })
  }

  const complete = payload.batch.eventCount === payload.events.length && payload.batch.headHash === expectedPrev
  if (!complete) problems.push('Chuỗi không kết thúc đúng tại đầu chuỗi đã ghi nhận — có thể đã bị cắt bớt')
  if (chainUnreachable) problems.push('Không kết nối được blockchain để đối chiếu — thử lại sau')

  const failed = !complete || events.some((e) => !e.linked || e.content === 'mismatch' || e.anchor === 'mismatch')
  // Every event is either anchored on-chain, or recomputed from its own data.
  const fullyProven = events.every((e) => e.anchor === 'anchored')
  return {
    overall: failed ? 'failed' : fullyProven ? 'verified' : 'partially-verified',
    events,
    complete,
    problems,
  }
}
