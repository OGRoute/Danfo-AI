// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * RouteCorrections — community-owned transit knowledge registry for DanfoAI.
 *
 * Users submit corrections to danfo/BRT route data (e.g. updated fares,
 * new connections, closed routes). Each correction is recorded on 0G Chain,
 * making the knowledge base auditable and community-owned. Optionally the
 * full correction payload lives on 0G Storage and only its root hash is
 * anchored here (cheap on-chain, verifiable off-chain).
 */
contract RouteCorrections {
    struct Correction {
        address contributor;
        string fromStop;     // e.g. "CMS"
        string toStop;       // e.g. "Oshodi"
        string detail;       // e.g. "Fare now 400 naira, danfo only"
        string storageHash;  // optional 0G Storage root hash for full payload
        uint256 timestamp;
        uint256 upvotes;
    }

    Correction[] public corrections;

    // contributor => number of corrections submitted (simple reputation)
    mapping(address => uint256) public contributionCount;
    // correctionId => voter => voted (prevents double-voting)
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    event CorrectionSubmitted(
        uint256 indexed id,
        address indexed contributor,
        string fromStop,
        string toStop
    );
    event CorrectionUpvoted(uint256 indexed id, address indexed voter, uint256 upvotes);

    function submitCorrection(
        string calldata fromStop,
        string calldata toStop,
        string calldata detail,
        string calldata storageHash
    ) external returns (uint256 id) {
        corrections.push(
            Correction({
                contributor: msg.sender,
                fromStop: fromStop,
                toStop: toStop,
                detail: detail,
                storageHash: storageHash,
                timestamp: block.timestamp,
                upvotes: 0
            })
        );
        id = corrections.length - 1;
        contributionCount[msg.sender] += 1;
        emit CorrectionSubmitted(id, msg.sender, fromStop, toStop);
    }

    function upvote(uint256 id) external {
        require(id < corrections.length, "bad id");
        require(!hasVoted[id][msg.sender], "already voted");
        hasVoted[id][msg.sender] = true;
        corrections[id].upvotes += 1;
        emit CorrectionUpvoted(id, msg.sender, corrections[id].upvotes);
    }

    function total() external view returns (uint256) {
        return corrections.length;
    }

    /** Return the most recent `n` corrections (newest first). */
    function recent(uint256 n) external view returns (Correction[] memory) {
        uint256 len = corrections.length;
        if (n > len) n = len;
        Correction[] memory out = new Correction[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = corrections[len - 1 - i];
        }
        return out;
    }
}
