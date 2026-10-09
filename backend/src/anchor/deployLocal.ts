import { createPublicClient, createWalletClient, getAddress, Hex, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import artifact from './TraceAnchor.artifact.json';

/**
 * One-shot deploy of TraceAnchor to the LOCAL development chain (the `anvil`
 * service in docker-compose). Idempotent: if the contract is already at
 * ANCHOR_CONTRACT (anvil state is persisted in a volume) it does nothing.
 *
 * The first contract deployed by anvil's well-known account #0 at nonce 0
 * always lands at the same address, so the backend and the frontend build
 * can be configured with it up front. Public testnets use
 * contracts/scripts/deploy.ts instead.
 */
async function main(): Promise<void> {
  const rpcUrl = process.env.ANCHOR_RPC_URL;
  const expected = process.env.ANCHOR_CONTRACT;
  const key = process.env.ANCHOR_PRIVATE_KEY as Hex | undefined;
  if (!rpcUrl || !expected || !key) throw new Error('Set ANCHOR_RPC_URL, ANCHOR_CONTRACT and ANCHOR_PRIVATE_KEY');

  const account = privateKeyToAccount(key);
  const publicClient = createPublicClient({ transport: http(rpcUrl) });
  const chainId = await publicClient.getChainId();

  for (let i = 0; i < 30; i++) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  const code = await publicClient.getCode({ address: getAddress(expected) });
  if (code && code !== '0x') {
    console.log(`TraceAnchor already deployed at ${expected} (chain ${chainId}).`);
    return;
  }

  const wallet = createWalletClient({ account, transport: http(rpcUrl), chain: undefined });
  const hash = await wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode as Hex,
    account,
    chain: { id: chainId, name: 'local', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } },
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const deployed = receipt.contractAddress;
  if (!deployed || getAddress(deployed) !== getAddress(expected)) {
    throw new Error(`TraceAnchor deployed at ${deployed}, but ANCHOR_CONTRACT is ${expected} — fix the configuration`);
  }
  console.log(`TraceAnchor deployed at ${deployed} (chain ${chainId}).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
