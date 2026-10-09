import { loadFixture } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';
import { getAddress, keccak256, toHex, zeroAddress, zeroHash } from 'viem';

const ROOT = keccak256(toHex('root-1'));
const ROOT2 = keccak256(toHex('root-2'));

async function deploy() {
  const [owner, anchorer, stranger] = await hre.viem.getWalletClients();
  const contract = await hre.viem.deployContract('TraceAnchor');
  const publicClient = await hre.viem.getPublicClient();
  const as = (wallet: typeof owner) =>
    hre.viem.getContractAt('TraceAnchor', contract.address, { client: { wallet } });
  return { contract, publicClient, owner, anchorer, stranger, as };
}

describe('TraceAnchor', () => {
  describe('deployment', () => {
    it('makes the deployer owner and anchorer', async () => {
      const { contract, owner } = await loadFixture(deploy);
      expect(await contract.read.owner()).to.equal(getAddress(owner.account.address));
      expect(await contract.read.isAnchorer([owner.account.address])).to.equal(true);
      expect(await contract.read.anchorCount()).to.equal(0n);
    });
  });

  describe('anchor', () => {
    it('records root, block, timestamp and leaf count, and emits Anchored', async () => {
      const { contract, publicClient } = await loadFixture(deploy);
      const hash = await contract.write.anchor([ROOT, 42]);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

      expect(await contract.read.anchoredAt([ROOT])).to.equal(block.timestamp);
      expect(await contract.read.anchoredBlock([ROOT])).to.equal(receipt.blockNumber);
      expect(await contract.read.getAnchor([ROOT])).to.deep.equal([block.timestamp, receipt.blockNumber, 42]);
      expect(await contract.read.anchorCount()).to.equal(1n);

      const events = await contract.getEvents.Anchored();
      expect(events).to.have.lengthOf(1);
      expect(events[0].args).to.deep.include({ id: 1n, root: ROOT, leafCount: 42, timestamp: block.timestamp });
    });

    it('numbers anchors sequentially', async () => {
      const { contract } = await loadFixture(deploy);
      await contract.write.anchor([ROOT, 1]);
      await contract.write.anchor([ROOT2, 1]);
      expect(await contract.read.anchorCount()).to.equal(2n);
    });

    it('returns 0 for a root that was never anchored', async () => {
      const { contract } = await loadFixture(deploy);
      expect(await contract.read.anchoredAt([ROOT])).to.equal(0n);
      expect(await contract.read.anchoredBlock([ROOT])).to.equal(0n);
    });

    it('rejects the same root twice (safe retries, no duplicates)', async () => {
      const { contract } = await loadFixture(deploy);
      await contract.write.anchor([ROOT, 3]);
      await expect(contract.write.anchor([ROOT, 3])).to.be.rejectedWith('AlreadyAnchored');
      expect(await contract.read.anchorCount()).to.equal(1n);
    });

    it('rejects an empty root and a zero leaf count', async () => {
      const { contract } = await loadFixture(deploy);
      await expect(contract.write.anchor([zeroHash, 1])).to.be.rejectedWith('EmptyRoot');
      await expect(contract.write.anchor([ROOT, 0])).to.be.rejectedWith('ZeroLeaves');
    });

    it('rejects callers that are not anchorers', async () => {
      const { stranger, as } = await loadFixture(deploy);
      const asStranger = await as(stranger);
      await expect(asStranger.write.anchor([ROOT, 1])).to.be.rejectedWith('NotAnchorer');
    });
  });

  describe('access control', () => {
    it('lets the owner grant and revoke anchorers', async () => {
      const { contract, anchorer, as } = await loadFixture(deploy);
      await contract.write.setAnchorer([anchorer.account.address, true]);
      const asAnchorer = await as(anchorer);
      await asAnchorer.write.anchor([ROOT, 1]);

      await contract.write.setAnchorer([anchorer.account.address, false]);
      await expect(asAnchorer.write.anchor([ROOT2, 1])).to.be.rejectedWith('NotAnchorer');
      const events = await contract.getEvents.AnchorerSet({}, { fromBlock: 0n });
      expect(events.at(-1)?.args).to.deep.include({ account: getAddress(anchorer.account.address), allowed: false });
    });

    it('only the owner manages anchorers and ownership', async () => {
      const { stranger, as } = await loadFixture(deploy);
      const asStranger = await as(stranger);
      await expect(asStranger.write.setAnchorer([stranger.account.address, true])).to.be.rejectedWith('NotOwner');
      await expect(asStranger.write.transferOwnership([stranger.account.address])).to.be.rejectedWith('NotOwner');
    });

    it('transfers ownership, and refuses the zero address', async () => {
      const { contract, anchorer, as } = await loadFixture(deploy);
      await expect(contract.write.transferOwnership([zeroAddress])).to.be.rejectedWith('ZeroAddress');
      await expect(contract.write.setAnchorer([zeroAddress, true])).to.be.rejectedWith('ZeroAddress');

      await contract.write.transferOwnership([anchorer.account.address]);
      expect(await contract.read.owner()).to.equal(getAddress(anchorer.account.address));
      const asNewOwner = await as(anchorer);
      await asNewOwner.write.setAnchorer([anchorer.account.address, true]);
      await expect(contract.write.setAnchorer([anchorer.account.address, false])).to.be.rejectedWith('NotOwner');
    });
  });
});
