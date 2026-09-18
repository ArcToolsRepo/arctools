// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArcClaim — USDC payment links on Arc
/// @notice A sender parks native USDC here together with the ADDRESS of a one-time claim key. Whoever holds that
///         key's private half (it travels inside the link) signs the recipient address of their choice and the
///         contract pays that recipient. Every deposit is its own record: the chain shows who funded it and who
///         collected it. Nothing is pooled and nothing is mixed — this is a transfer with a deferred recipient.
///
///         Fee: FEE_BPS of the amount, taken at claim time and sent to the treasury. Unclaimed links are refunded to
///         the sender after their expiry by anyone calling refund(). The claim signature binds the recipient, so a
///         watcher who sees the transaction in flight cannot redirect the funds to himself.
contract ArcClaim {
    struct Link {
        address sender;
        address claimKey;   // address of the one-time key embedded in the link
        uint128 amount;     // native USDC, 18 decimals on Arc
        uint64  expiry;     // unix seconds; refundable to sender after this
        uint8   status;     // 0 open, 1 claimed, 2 refunded
    }

    uint256 public constant FEE_BPS = 200;              // 2 %
    uint256 public constant MIN_AMOUNT = 0.1 ether;     // 0.1 USDC
    uint256 public constant MAX_TTL = 90 days;

    address public immutable treasury;
    uint256 public nextId = 1;
    mapping(uint256 => Link) public links;
    mapping(address => bool) public keyUsed;            // a claim key is single-use forever

    event Created(uint256 indexed id, address indexed sender, address indexed claimKey, uint256 amount, uint64 expiry);
    event Claimed(uint256 indexed id, address indexed recipient, uint256 paid, uint256 fee);
    event Refunded(uint256 indexed id, address indexed sender, uint256 amount);

    error BadAmount();
    error BadExpiry();
    error KeyReused();
    error NotOpen();
    error Expired();
    error NotExpired();
    error BadSignature();
    error TransferFailed();

    constructor(address _treasury) {
        require(_treasury != address(0), "treasury");
        treasury = _treasury;
    }

    /// @param claimKey address derived from the one-time private key that lives in the link
    /// @param ttl seconds until the sender can take the money back (1 h .. 90 d)
    function create(address claimKey, uint64 ttl) external payable returns (uint256 id) {
        if (msg.value < MIN_AMOUNT || msg.value > type(uint128).max) revert BadAmount();
        if (ttl < 1 hours || ttl > MAX_TTL) revert BadExpiry();
        if (claimKey == address(0) || keyUsed[claimKey]) revert KeyReused();
        keyUsed[claimKey] = true;
        id = nextId++;
        uint64 expiry = uint64(block.timestamp) + ttl;
        links[id] = Link(msg.sender, claimKey, uint128(msg.value), expiry, 0);
        emit Created(id, msg.sender, claimKey, msg.value, expiry);
    }

    /// @notice Message the claim key signs (EIP-191 personal_sign of this hash), binding the recipient and this
    ///         contract + chain so a signature cannot be replayed elsewhere.
    function claimDigest(uint256 id, address recipient) public view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32",
            keccak256(abi.encode("ArcClaim", block.chainid, address(this), id, recipient))));
    }

    /// @param sig 65-byte signature by the link's claim key over claimDigest(id, recipient)
    function claim(uint256 id, address recipient, bytes calldata sig) external {
        Link storage l = links[id];
        if (l.status != 0 || l.sender == address(0)) revert NotOpen();
        if (block.timestamp >= l.expiry) revert Expired();
        if (recipient == address(0)) revert BadSignature();
        if (_recover(claimDigest(id, recipient), sig) != l.claimKey) revert BadSignature();
        l.status = 1;
        uint256 fee = uint256(l.amount) * FEE_BPS / 10_000;
        uint256 paid = uint256(l.amount) - fee;
        _pay(treasury, fee);
        _pay(recipient, paid);
        emit Claimed(id, recipient, paid, fee);
    }

    /// @notice After expiry anyone may trigger the refund; the money can only go back to the sender.
    function refund(uint256 id) external {
        Link storage l = links[id];
        if (l.status != 0 || l.sender == address(0)) revert NotOpen();
        if (block.timestamp < l.expiry) revert NotExpired();
        l.status = 2;
        _pay(l.sender, l.amount);
        emit Refunded(id, l.sender, l.amount);
    }

    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        // reject high-s signatures (malleability)
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
