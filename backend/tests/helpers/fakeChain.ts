import { createHash } from 'crypto';
import { Address, Hex } from 'viem';
import { AnchorChain } from '../../src/anchor/chain';

/**
 * In-memory stand-in for the TraceAnchor contract + node, with switches to
 * inject the failures the worker must survive: RPC errors on submit, a tx
 * that is broadcast but never mined, a lost receipt after the tx DID mine.
 */
export class FakeChain implements AnchorChain {
  readonly chainId = 31337;
  readonly contractAddress: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';

  private anchored = new Map<string, { timestamp: Date; blockNumber: number }>();
  private txs = new Map<Hex, { root: string; mined: boolean; blockNumber?: number }>();
  private block = 100;
  submitCalls = 0;

  /** Next submit throws (RPC down). */
  failNextSubmit = false;
  /** Next submitted tx is broadcast but never mined (dropped from the mempool). */
  dropNextTx = false;
  /** Next submitted tx mines, but waitForReceipt reports a timeout (lost response). */
  loseNextReceipt = false;

  anchoredRoots(): string[] {
    return [...this.anchored.keys()];
  }

  async getAnchor(rootHex: string) {
    return this.anchored.get(rootHex) ?? null;
  }

  async submit(rootHex: string, _leafCount: number): Promise<Hex> {
    this.submitCalls += 1;
    if (this.failNextSubmit) {
      this.failNextSubmit = false;
      throw new Error('RPC unavailable');
    }
    if (this.anchored.has(rootHex)) throw new Error('execution reverted: AlreadyAnchored');
    const txHash = `0x${createHash('sha256').update(`${rootHex}:${this.submitCalls}`).digest('hex')}` as Hex;
    const dropped = this.dropNextTx;
    this.dropNextTx = false;
    this.txs.set(txHash, { root: rootHex, mined: false });
    if (!dropped) this.mine(txHash);
    return txHash;
  }

  private mine(txHash: Hex): void {
    const tx = this.txs.get(txHash)!;
    this.block += 1;
    tx.mined = true;
    tx.blockNumber = this.block;
    this.anchored.set(tx.root, { timestamp: new Date(Date.UTC(2026, 9, 1, 0, 0, this.block)), blockNumber: this.block });
  }

  async waitForReceipt(txHash: Hex) {
    const tx = this.txs.get(txHash);
    if (this.loseNextReceipt) {
      this.loseNextReceipt = false;
      return null;
    }
    if (!tx || !tx.mined) return null;
    return { success: true, blockNumber: tx.blockNumber! };
  }
}
