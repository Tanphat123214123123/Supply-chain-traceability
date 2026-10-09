import { createHash } from 'crypto';
import { Address, Hex } from 'viem';
import { AnchorWorker } from '../src/anchor/anchorWorker';
import { ViemAnchorChain } from '../src/anchor/chain';
import { verifyInclusion } from '../src/ledger/merkle';
import { createActor, createTenant, sampleBatch, useTestDatabase } from './helpers/testDb';

/**
 * Against a REAL EVM node with TraceAnchor deployed — runs only when
 * ANCHOR_IT_RPC_URL points at one (e.g. `docker compose up -d anvil
 * anchor-deploy`, then ANCHOR_IT_RPC_URL=http://127.0.0.1:8545). The fake
 * chain in anchorWorker.test.ts covers failure handling; this proves the
 * viem calls, the contract ABI and the worker agree with each other.
 */
const rpc = process.env.ANCHOR_IT_RPC_URL;
const describeIfChain = rpc ? describe : describe.skip;

const getDb = useTestDatabase();

describeIfChain('ViemAnchorChain + TraceAnchor (live node)', () => {
  const chain = () =>
    new ViemAnchorChain({
      rpcUrls: [rpc!],
      chainId: Number(process.env.ANCHOR_IT_CHAIN_ID ?? 31337),
      contractAddress: (process.env.ANCHOR_IT_CONTRACT ?? '0x5FbDB2315678afecb367f032d93F642f64180aa3') as Address,
      // anvil's public dev key #0 by default.
      privateKey: (process.env.ANCHOR_IT_PRIVATE_KEY ??
        '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as Hex,
    });

  it('submits a root, reads it back, and refuses it a second time', async () => {
    const c = chain();
    const root = createHash('sha256').update(`it-${Date.now()}-${Math.random()}`).digest('hex');
    expect(await c.getAnchor(root)).toBeNull();
    const tx = await c.submit(root, 3);
    const receipt = await c.waitForReceipt(tx, 1, 30_000);
    expect(receipt).toMatchObject({ success: true });
    const onChain = await c.getAnchor(root);
    expect(onChain?.blockNumber).toBe(receipt!.blockNumber);
    await expect(c.submit(root, 3)).rejects.toThrow(/AlreadyAnchored/);
  });

  it('worker anchors real events end to end', async () => {
    const t = getDb();
    const tenant = await createTenant(t);
    const admin = await createActor(t, tenant, 'ADMIN');
    const batch = await t.ctx.supplyChainService.createBatch(admin, sampleBatch);
    await t.ctx.supplyChainService.recordEvent(admin, { batchId: batch.id, stage: 'HARVEST', location: 'x' });

    const w = new AnchorWorker(t.ctx.anchorStore, chain(), { maxLeaves: 100, confirmations: 1, receiptTimeoutMs: 30_000, resubmitAfterMs: 60_000 });
    expect(await w.tick()).toMatchObject({ action: 'submitted' });
    expect(await w.tick()).toMatchObject({ action: 'confirmed' });

    const [e] = (await t.ctx.traceService.verifyPublic(batch.id)).events;
    expect(e.anchor?.anchor.status).toBe('confirmed');
    expect(verifyInclusion(e.hash, e.anchor!.leafIndex, e.anchor!.anchor.leafCount, e.anchor!.proof, e.anchor!.anchor.root)).toBe(true);
    expect(await chain().getAnchor(e.anchor!.anchor.root)).not.toBeNull();
  });
});
