import hre from 'hardhat';

/**
 * Deploys TraceAnchor to the selected network and (optionally) authorises the
 * worker's wallet as anchorer:
 *   ANCHOR_DEPLOYER_KEY=0x... ANCHOR_WORKER_ADDRESS=0x... npx hardhat run scripts/deploy.ts --network baseSepolia
 * Then set ANCHOR_CONTRACT (backend) and VITE_ANCHOR_CONTRACT (frontend build).
 */
async function main() {
  const contract = await hre.viem.deployContract('TraceAnchor');
  const publicClient = await hre.viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  console.log(`TraceAnchor deployed at ${contract.address} (chain ${chainId})`);

  const worker = process.env.ANCHOR_WORKER_ADDRESS as `0x${string}` | undefined;
  if (worker) {
    const hash = await contract.write.setAnchorer([worker, true]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`Authorised anchorer ${worker}`);
  }
  console.log(`Verify the source: npx hardhat verify --network ${hre.network.name} ${contract.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
