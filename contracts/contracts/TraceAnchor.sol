// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title TraceAnchor
/// @notice Public, append-only registry of Merkle roots over TraceChain event
///         hashes (docs/SPEC_PHASE1.md §2). Each root commits to a batch of
///         supply-chain events; anyone holding an event and its inclusion proof
///         can check it against `anchoredAt(root)` without trusting TraceChain.
/// @dev Deliberately minimal: no product data, no token, no business logic.
///      A root can be anchored once — so a worker that retries after a lost
///      receipt can never create a duplicate entry.
contract TraceAnchor {
    struct Anchor {
        uint64 timestamp; // block.timestamp of the anchoring transaction
        uint64 blockNumber;
        uint32 leafCount;
    }

    address public owner;
    mapping(address => bool) public isAnchorer;
    mapping(bytes32 => Anchor) private anchors;
    uint256 public anchorCount;

    event Anchored(uint256 indexed id, bytes32 indexed root, uint32 leafCount, uint64 timestamp);
    event AnchorerSet(address indexed account, bool allowed);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotAnchorer();
    error ZeroAddress();
    error EmptyRoot();
    error ZeroLeaves();
    error AlreadyAnchored(bytes32 root);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
        isAnchorer[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit AnchorerSet(msg.sender, true);
    }

    /// @notice Records `root` as existing from this block on.
    /// @return id Sequential number of this anchor (1-based).
    function anchor(bytes32 root, uint32 leafCount) external returns (uint256 id) {
        if (!isAnchorer[msg.sender]) revert NotAnchorer();
        if (root == bytes32(0)) revert EmptyRoot();
        if (leafCount == 0) revert ZeroLeaves();
        if (anchors[root].timestamp != 0) revert AlreadyAnchored(root);

        uint64 ts = uint64(block.timestamp);
        anchors[root] = Anchor({timestamp: ts, blockNumber: uint64(block.number), leafCount: leafCount});
        id = ++anchorCount;
        emit Anchored(id, root, leafCount, ts);
    }

    /// @return Block timestamp at which `root` was anchored; 0 if never.
    function anchoredAt(bytes32 root) external view returns (uint64) {
        return anchors[root].timestamp;
    }

    /// @return Block number at which `root` was anchored; 0 if never.
    function anchoredBlock(bytes32 root) external view returns (uint64) {
        return anchors[root].blockNumber;
    }

    function getAnchor(bytes32 root) external view returns (uint64 timestamp, uint64 blockNumber, uint32 leafCount) {
        Anchor memory a = anchors[root];
        return (a.timestamp, a.blockNumber, a.leafCount);
    }

    function setAnchorer(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isAnchorer[account] = allowed;
        emit AnchorerSet(account, allowed);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
