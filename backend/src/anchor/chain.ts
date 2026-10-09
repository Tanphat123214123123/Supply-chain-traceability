import {
  Account,
  Address,
  BaseError,
  Chain,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  Hex,
  http,
  PublicClient,
  WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import artifact from './TraceAnchor.artifact.json';

/**
 * The anchoring worker's view of the blockchain. Kept this small so the
 * worker's failure handling can be tested against an in-memory fake
 * (tests/helpers/fakeChain.ts) without a node.
 */
export interface AnchorChain {
  readonly chainId: number;
  readonly contractAddress: Address;
  /** Where/when `root` was anchored on-chain; null if it never was. */
  getAnchor(rootHex: string): Promise<{ timestamp: Date; blockNumber: number } | null>;
  /** Sends `anchor(root, leafCount)`; resolves with the tx hash once broadcast. */
  submit(rootHex: string, leafCount: number): Promise<Hex>;
  /** Waits for the receipt plus `confirmations` blocks; null on timeout (tx still pending or dropped). */
  waitForReceipt(txHash: Hex, confirmations: number, timeoutMs: number): Promise<{ success: boolean; blockNumber: number } | null>;
}

export interface ViemAnchorChainConfig {
  /** One or more RPC URLs, tried in order (viem `fallback` transport). */
  rpcUrls: string[];
  chainId: number;
  contractAddress: Address;
  /** Key of a wallet the contract authorises via setAnchorer. */
  privateKey: Hex;
}

const abi = artifact.abi;

export function toBytes32(rootHex: string): Hex {
  if (!/^[0-9a-f]{64}$/.test(rootHex)) throw new Error(`anchor: root must be 64 lowercase hex chars`);
  return `0x${rootHex}`;
}

export class ViemAnchorChain implements AnchorChain {
  readonly chainId: number;
  readonly contractAddress: Address;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: Account;
  private readonly chain: Chain;

  constructor(config: ViemAnchorChainConfig) {
    this.chainId = config.chainId;
    this.contractAddress = config.contractAddress;
    this.chain = defineChain({
      id: config.chainId,
      name: `chain-${config.chainId}`,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: config.rpcUrls } },
    });
    const transport = fallback(config.rpcUrls.map((url) => http(url, { retryCount: 2, timeout: 15_000 })));
    this.account = privateKeyToAccount(config.privateKey);
    this.publicClient = createPublicClient({ chain: this.chain, transport });
    this.walletClient = createWalletClient({ chain: this.chain, transport, account: this.account });
  }

  async getAnchor(rootHex: string): Promise<{ timestamp: Date; blockNumber: number } | null> {
    const [timestamp, blockNumber] = (await this.publicClient.readContract({
      address: this.contractAddress,
      abi,
      functionName: 'getAnchor',
      args: [toBytes32(rootHex)],
    })) as [bigint, bigint, number];
    if (timestamp === 0n) return null;
    return { timestamp: new Date(Number(timestamp) * 1000), blockNumber: Number(blockNumber) };
  }

  async submit(rootHex: string, leafCount: number): Promise<Hex> {
    // Simulate first: a revert (e.g. AlreadyAnchored, NotAnchorer) surfaces
    // here with its reason instead of as a mined failed transaction.
    const { request } = await this.publicClient.simulateContract({
      address: this.contractAddress,
      abi,
      functionName: 'anchor',
      args: [toBytes32(rootHex), leafCount],
      account: this.account,
    });
    return this.walletClient.writeContract(request);
  }

  async waitForReceipt(txHash: Hex, confirmations: number, timeoutMs: number) {
    try {
      const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash, confirmations, timeout: timeoutMs });
      return { success: receipt.status === 'success', blockNumber: Number(receipt.blockNumber) };
    } catch (err) {
      if (err instanceof BaseError && err.name === 'WaitForTransactionReceiptTimeoutError') return null;
      throw err;
    }
  }
}

/** The custom error name inside a viem revert, e.g. "AlreadyAnchored". */
export function revertReason(err: unknown): string | undefined {
  if (!(err instanceof BaseError)) return undefined;
  const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
  return revert instanceof ContractFunctionRevertedError ? revert.data?.errorName : undefined;
}

export interface AnchorConfig extends ViemAnchorChainConfig {
  intervalMs: number;
  confirmations: number;
  maxLeaves: number;
}

/** Reads ANCHOR_* env vars; null (anchoring disabled) when they're not all set. */
export function anchorConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AnchorConfig | null {
  const { ANCHOR_RPC_URL, ANCHOR_CHAIN_ID, ANCHOR_CONTRACT, ANCHOR_PRIVATE_KEY } = env;
  if (!ANCHOR_RPC_URL || !ANCHOR_CHAIN_ID || !ANCHOR_CONTRACT || !ANCHOR_PRIVATE_KEY) return null;
  if (!/^0x[0-9a-fA-F]{40}$/.test(ANCHOR_CONTRACT)) throw new Error('ANCHOR_CONTRACT must be a 0x-prefixed address');
  if (!/^0x[0-9a-fA-F]{64}$/.test(ANCHOR_PRIVATE_KEY)) throw new Error('ANCHOR_PRIVATE_KEY must be a 0x-prefixed 32-byte key');
  const int = (name: string, fallbackValue: number) => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallbackValue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
    return n;
  };
  return {
    rpcUrls: ANCHOR_RPC_URL.split(',').map((u) => u.trim()).filter(Boolean),
    chainId: int('ANCHOR_CHAIN_ID', 0),
    contractAddress: ANCHOR_CONTRACT as Address,
    privateKey: ANCHOR_PRIVATE_KEY as Hex,
    intervalMs: int('ANCHOR_INTERVAL_MS', 60_000),
    confirmations: Math.max(1, int('ANCHOR_CONFIRMATIONS', 2)),
    maxLeaves: Math.max(1, int('ANCHOR_MAX_LEAVES', 4096)),
  };
}
