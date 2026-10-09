import '@nomicfoundation/hardhat-toolbox-viem';
import type { HardhatUserConfig } from 'hardhat/config';

/**
 * Networks:
 *   hardhat   — in-process chain for `npm test` / `npm run coverage`
 *   localhost — the `anvil` service from docker-compose (port 8545)
 *   baseSepolia / arbitrumSepolia / polygonAmoy — public L2 testnets;
 *     need ANCHOR_DEPLOYER_KEY (a funded testnet key — never a mainnet key).
 */
const deployer = process.env.ANCHOR_DEPLOYER_KEY ? [process.env.ANCHOR_DEPLOYER_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' },
  },
  networks: {
    localhost: { url: process.env.ANCHOR_RPC_URL ?? 'http://127.0.0.1:8545' },
    baseSepolia: { url: process.env.BASE_SEPOLIA_RPC ?? 'https://sepolia.base.org', chainId: 84532, accounts: deployer },
    arbitrumSepolia: {
      url: process.env.ARBITRUM_SEPOLIA_RPC ?? 'https://sepolia-rollup.arbitrum.io/rpc',
      chainId: 421614,
      accounts: deployer,
    },
    polygonAmoy: { url: process.env.POLYGON_AMOY_RPC ?? 'https://rpc-amoy.polygon.technology', chainId: 80002, accounts: deployer },
  },
  etherscan: {
    // Source verification on the explorer (`npx hardhat verify --network baseSepolia <address>`).
    apiKey: process.env.ETHERSCAN_API_KEY ?? '',
  },
};

export default config;
