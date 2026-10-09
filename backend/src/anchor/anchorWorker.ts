import { Hex } from 'viem';
import { AnchorChain, revertReason } from './chain';
import { AnchorRecord, AnchorStore } from './anchorStore';

export interface AnchorWorkerOptions {
  maxLeaves: number;
  confirmations: number;
  /** How long one tick waits for a receipt before giving up until the next tick. */
  receiptTimeoutMs: number;
  /** A submitted tx with no receipt for this long is assumed dropped and sent again. */
  resubmitAfterMs: number;
}

export type TickOutcome =
  | { action: 'idle' }
  | { action: 'submitted'; anchor: AnchorRecord; txHash: string }
  | { action: 'confirmed'; anchor: AnchorRecord }
  | { action: 'waiting'; anchor: AnchorRecord }
  | { action: 'error'; anchor?: AnchorRecord; error: string };

function message(err: unknown): string {
  return err instanceof Error ? err.message.split('\n')[0] : String(err);
}

/**
 * Seals events into Merkle roots on-chain (docs/SPEC_PHASE1.md §2.4):
 *   built → submitted → confirmed, one batch in flight at a time.
 * Every step is idempotent and resumable: after a crash, a lost RPC response
 * or a dropped transaction, the next tick looks at the chain itself
 * (`getAnchor(root)`) before doing anything, and the contract refuses to
 * anchor the same root twice — so nothing is lost and nothing is duplicated.
 */
export class AnchorWorker {
  private running = false;

  constructor(
    private readonly store: AnchorStore,
    private readonly chain: AnchorChain,
    private readonly options: AnchorWorkerOptions,
  ) {}

  /** One step of progress. Overlapping calls (a slow tick and the next timer) are skipped. */
  async tick(): Promise<TickOutcome> {
    if (this.running) return { action: 'idle' };
    this.running = true;
    try {
      const inFlight =
        (await this.store.findInFlight()) ??
        (await this.store.buildBatch({
          maxLeaves: this.options.maxLeaves,
          chainId: this.chain.chainId,
          contractAddress: this.chain.contractAddress,
        }));
      if (!inFlight) return { action: 'idle' };
      return await this.advance(inFlight);
    } catch (err) {
      return { action: 'error', error: message(err) };
    } finally {
      this.running = false;
    }
  }

  private async confirmFromChain(anchor: AnchorRecord): Promise<TickOutcome | null> {
    const onChain = await this.chain.getAnchor(anchor.root);
    if (!onChain) return null;
    await this.store.markConfirmed(anchor.id, onChain.blockNumber, onChain.timestamp);
    return { action: 'confirmed', anchor: { ...anchor, status: 'confirmed', blockNumber: onChain.blockNumber, anchoredAt: onChain.timestamp } };
  }

  private async advance(anchor: AnchorRecord): Promise<TickOutcome> {
    // Whatever our records say, the chain is the source of truth.
    const already = await this.confirmFromChain(anchor);
    if (already) return already;

    if (anchor.status === 'built') {
      try {
        const txHash = await this.chain.submit(anchor.root, anchor.leafCount);
        const submittedAt = new Date();
        await this.store.markSubmitted(anchor.id, txHash, submittedAt);
        return { action: 'submitted', anchor: { ...anchor, status: 'submitted', txHash, submittedAt }, txHash };
      } catch (err) {
        // A concurrent/earlier send may have landed between getAnchor and submit.
        if (revertReason(err) === 'AlreadyAnchored') {
          return (await this.confirmFromChain(anchor)) ?? { action: 'error', anchor, error: 'AlreadyAnchored but not readable yet' };
        }
        await this.store.recordError(anchor.id, message(err));
        return { action: 'error', anchor, error: message(err) };
      }
    }

    // submitted: wait for the receipt
    const receipt = await this.chain.waitForReceipt(anchor.txHash as Hex, this.options.confirmations, this.options.receiptTimeoutMs);
    if (receipt) {
      const confirmed = await this.confirmFromChain(anchor);
      if (confirmed) return confirmed;
      // Mined but the root isn't there: the tx reverted. Send again.
      await this.store.markForResubmit(anchor.id, receipt.success ? 'receipt ok but root not found' : 'transaction reverted');
      return { action: 'error', anchor, error: 'transaction did not anchor the root' };
    }

    const age = Date.now() - (anchor.submittedAt?.getTime() ?? 0);
    if (age >= this.options.resubmitAfterMs) {
      await this.store.markForResubmit(anchor.id, `no receipt after ${Math.round(age / 1000)}s — resubmitting`);
    }
    return { action: 'waiting', anchor };
  }

  /** Runs `tick` every `intervalMs` until the returned stop function is called. */
  start(intervalMs: number, log: (outcome: TickOutcome) => void = () => undefined): () => void {
    let stopped = false;
    let timer: NodeJS.Timeout | undefined;
    const loop = async () => {
      if (stopped) return;
      const outcome = await this.tick();
      if (outcome.action !== 'idle') log(outcome);
      // Keep going straight away while there is progress to make (e.g. after
      // confirming, the next batch can be built without waiting a full interval).
      const delay = outcome.action === 'confirmed' || outcome.action === 'submitted' ? 1_000 : intervalMs;
      if (!stopped) timer = setTimeout(loop, delay);
      timer?.unref?.();
    };
    timer = setTimeout(loop, 1_000);
    timer.unref?.();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }
}
