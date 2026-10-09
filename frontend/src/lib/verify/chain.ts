import { createPublicClient, fallback, http, type Address } from 'viem'
import { traceAnchorAbi } from './traceAnchorAbi'

/**
 * Where the verifier looks for anchored roots. Baked into the BUILD
 * (VITE_ANCHOR_*), not fetched from the TraceChain API — so a compromised
 * server can't point the verifier at a contract it controls. The address is
 * shown on the page so anyone can compare it with the published one.
 */
export interface AnchorChainConfig {
  chainId: number
  contractAddress: Address
  rpcUrls: string[]
  explorerUrl?: string
}

export function anchorChainConfig(env: Record<string, string | undefined> = import.meta.env): AnchorChainConfig | null {
  const chainId = Number(env.VITE_ANCHOR_CHAIN_ID)
  const contract = env.VITE_ANCHOR_CONTRACT
  const rpcUrls = (env.VITE_ANCHOR_RPC_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean)
  if (!Number.isInteger(chainId) || chainId <= 0 || !contract || !/^0x[0-9a-fA-F]{40}$/.test(contract) || rpcUrls.length === 0) {
    return null
  }
  return {
    chainId,
    contractAddress: contract as Address,
    rpcUrls,
    explorerUrl: env.VITE_ANCHOR_EXPLORER_URL?.replace(/\/$/, '') || undefined,
  }
}

/** What the verifier asks the chain: when (if ever) was this root anchored? */
export interface AnchorReader {
  getAnchor(rootHex: string): Promise<{ timestamp: Date; blockNumber: number } | null>
}

export function createAnchorReader(config: AnchorChainConfig): AnchorReader {
  const client = createPublicClient({
    transport: fallback(config.rpcUrls.map((url) => http(url, { retryCount: 1, timeout: 10_000 }))),
  })
  return {
    async getAnchor(rootHex: string) {
      const [timestamp, blockNumber] = await client.readContract({
        address: config.contractAddress,
        abi: traceAnchorAbi,
        functionName: 'getAnchor',
        args: [`0x${rootHex}`],
      })
      if (timestamp === 0n) return null
      return { timestamp: new Date(Number(timestamp) * 1000), blockNumber: Number(blockNumber) }
    },
  }
}
