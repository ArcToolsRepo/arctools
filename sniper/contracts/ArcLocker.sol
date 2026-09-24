// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/*
 *  ArcLocker — token, LP and position locker for Arc (chain 5042).
 *
 *  Locks three kinds of things behind a time:
 *    - ERC-20 tokens (project tokens, team allocations, Uniswap V2-style LP tokens)   → lockERC20
 *    - ERC-721 positions: Uniswap V3 NonfungiblePositionManager NFTs,
 *      Uniswap v4 Positions NFTs, or any other ERC-721                                 → lockERC721
 *
 *  Rules
 *    - A lock has an owner (can extend, transfer ownership, withdraw after unlock) and an unlock time that can
 *      only move LATER. No admin key can move a lock's assets anywhere but back to the lock's own owner:
 *      the ONLY emergency path is `announceRescue(id)` (public event) followed, at least 48 h later, by
 *      `rescue(id)`, which returns the asset to the lock owner. It exists for contract bugs (e.g. a token whose
 *      transfer changes behaviour). Worst-case abuse = somebody gets their own tokens back early, in public.
 *      The platform owner can otherwise only change the fee, the fee receiver and the fee-exempt list.
 *      There is no pause and no upgrade.
 *    - Optional linear vesting for ERC-20 locks: nothing before `unlockAt`, then linear until `vestEnd`
 *      (vestEnd == unlockAt → everything at once).
 *    - V3 positions keep earning: while locked, the owner can collect the position's swap fees to any address
 *      (collect() with the locker as position owner) — the principal stays locked. Not offered for v4 (fee
 *      collection there needs an unlock-callback flow; a v4 position stays fully locked).
 *    - Fee-on-transfer tokens: the locked amount is what actually arrived.
 *    - Flat platform fee in native USDC per lock (owner-tunable, capped at 200 USDC) → treasury; owner-listed
 *      project wallets are exempt. Extending / withdrawing is free.
 *
 *  Indexing: every state change emits an event carrying the token (ERC-20) or the pool pair (V3/v4 positions are
 *  resolved on-chain at lock time), so a token page can show "LP locked until …" without off-chain guesswork.
 */

interface IERC20 {
    function transfer(address to, uint256 v) external returns (bool);
    function transferFrom(address f, address t, uint256 v) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}
interface IERC721 {
    function transferFrom(address f, address t, uint256 id) external;
    function safeTransferFrom(address f, address t, uint256 id) external;
    function ownerOf(uint256 id) external view returns (address);
}
interface INPMv3 {
    struct CollectParams { uint256 tokenId; address recipient; uint128 amount0Max; uint128 amount1Max; }
    function positions(uint256 tokenId) external view returns (
        uint96 nonce, address operator, address token0, address token1, uint24 fee, int24 tickLower, int24 tickUpper,
        uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128, uint128 tokensOwed0, uint128 tokensOwed1);
    function collect(CollectParams calldata p) external payable returns (uint256 amount0, uint256 amount1);
}
interface IPosMv4 {
    // Uniswap v4 PositionManager: poolKeys(bytes25 poolId) and getPoolAndPositionInfo(tokenId)
    function getPoolAndPositionInfo(uint256 tokenId) external view returns (PoolKey memory poolKey, uint256 info);
    struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
}
interface IUniV2Pair { function token0() external view returns (address); function token1() external view returns (address); }

contract ArcLocker {
    // ------------------------------------------------------------------ config
    address public owner;
    address public treasury;
    uint256 public lockFee = 50e18;                // native USDC is 18-dec on Arc; 50 USDC per new lock
    uint256 public constant MAX_FEE = 200e18;
    mapping(address => bool) public feeExempt;     // project wallets lock for free (owner-managed)
    address public constant V3_NPM = 0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377;
    address public constant V4_POSM = 0x6049c9a0e26405C0985f9E3685C87d0aE917f82B;

    enum Kind { ERC20, ERC721 }

    struct Lock {
        Kind    kind;
        address asset;        // ERC-20 token or ERC-721 collection
        uint256 amountOrId;   // ERC-20: amount still locked (decreases on vested withdrawals); ERC-721: tokenId
        uint256 initial;      // ERC-20: amount locked at creation (for vesting math)
        address lockOwner;
        uint64  lockedAt;
        uint64  unlockAt;     // nothing can leave before this
        uint64  vestEnd;      // ERC-20 only: linear release between unlockAt and vestEnd; == unlockAt → cliff
        address token0;       // resolved pair (LP / position) or asset itself for a plain token
        address token1;       // address(0) for a plain token
        bool    withdrawn;    // ERC-721 fully withdrawn / ERC-20 emptied
    }

    Lock[] public locks;
    mapping(address => uint256[]) private _byOwner;      // lockOwner → lock ids (historical; check .lockOwner)
    mapping(address => uint256[]) private _byToken;      // token0 / token1 / asset → lock ids

    event Locked(uint256 indexed id, address indexed lockOwner, Kind kind, address indexed asset, uint256 amountOrId, uint64 unlockAt, uint64 vestEnd, address token0, address token1);
    event Extended(uint256 indexed id, uint64 unlockAt, uint64 vestEnd);
    event Transferred(uint256 indexed id, address indexed from, address indexed to);
    event Withdrawn(uint256 indexed id, address indexed to, uint256 amountOrId, bool complete);
    event FeesCollected(uint256 indexed id, address indexed to, uint256 amount0, uint256 amount1);
    event FeeChanged(uint256 fee, address treasury);

    modifier onlyOwner() { require(msg.sender == owner, "owner"); _; }
    modifier onlyLockOwner(uint256 id) { require(id < locks.length && locks[id].lockOwner == msg.sender, "not lock owner"); _; }
    uint256 private _g = 1;
    modifier nonReentrant() { require(_g == 1, "reentrancy"); _g = 2; _; _g = 1; }

    event ExemptChanged(address indexed who, bool exempt);
    event RescueAnnounced(uint256 indexed id, uint64 executableAt, string reason);
    event RescueCancelled(uint256 indexed id);
    event Rescued(uint256 indexed id, address indexed to, uint256 amountOrId);
    uint64 public constant RESCUE_DELAY = 48 hours;
    mapping(uint256 => uint64) public rescueAt;    // lock id → earliest time rescue(id) may run (0 = none announced)
    constructor(address _treasury) { owner = msg.sender; treasury = _treasury; feeExempt[msg.sender] = true; feeExempt[_treasury] = true; }

    // ------------------------------------------------------------------ admin (fee only — never the locks)
    function setFee(uint256 fee, address _treasury) external onlyOwner {
        require(fee <= MAX_FEE && _treasury != address(0), "fee");
        lockFee = fee; treasury = _treasury; emit FeeChanged(fee, _treasury);
    }
    function transferOwnership(address n) external onlyOwner { require(n != address(0), "zero"); owner = n; }
    function setExempt(address who, bool exempt) external onlyOwner { feeExempt[who] = exempt; emit ExemptChanged(who, exempt); }

    // ------------------------------------------------------------------ emergency path (to the lock owner only)
    function announceRescue(uint256 id, string calldata reason) external onlyOwner {
        require(id < locks.length && !locks[id].withdrawn, "no lock");
        rescueAt[id] = uint64(block.timestamp) + RESCUE_DELAY;
        emit RescueAnnounced(id, rescueAt[id], reason);
    }
    function cancelRescue(uint256 id) external onlyOwner { delete rescueAt[id]; emit RescueCancelled(id); }
    /// @notice After the announced delay: return the locked asset to the lock's owner. Nothing else is possible.
    function rescue(uint256 id) external onlyOwner nonReentrant {
        Lock storage L = locks[id];
        require(rescueAt[id] != 0 && block.timestamp >= rescueAt[id], "not announced / too early");
        require(!L.withdrawn, "withdrawn");
        delete rescueAt[id];
        L.withdrawn = true;
        uint256 amt = L.amountOrId; L.amountOrId = 0;
        if (L.kind == Kind.ERC721) IERC721(L.asset).transferFrom(address(this), L.lockOwner, amt);
        else require(IERC20(L.asset).transfer(L.lockOwner, amt), "transfer");
        emit Rescued(id, L.lockOwner, amt);
    }

    // ------------------------------------------------------------------ lock
    function _takeFee() internal {
        uint256 due = feeExempt[msg.sender] ? 0 : lockFee;
        require(msg.value == due, "fee");
        if (msg.value > 0) { (bool ok, ) = treasury.call{value: msg.value}(""); require(ok, "treasury"); }
    }
    /// what a given wallet pays to create a lock right now
    function feeFor(address who) external view returns (uint256) { return feeExempt[who] ? 0 : lockFee; }

    /// @notice Lock ERC-20 tokens (project tokens or V2-style LP). `vestEnd` == `unlockAt` for a plain cliff.
    function lockERC20(address token, uint256 amount, uint64 unlockAt, uint64 vestEnd, address lockOwner)
        external payable nonReentrant returns (uint256 id)
    {
        require(amount > 0, "amount");
        require(unlockAt > block.timestamp && unlockAt <= block.timestamp + 3650 days, "unlock time");
        require(vestEnd >= unlockAt && vestEnd <= unlockAt + 3650 days, "vest end");
        if (lockOwner == address(0)) lockOwner = msg.sender;
        _takeFee();
        uint256 before = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "transferFrom");
        uint256 got = IERC20(token).balanceOf(address(this)) - before;   // fee-on-transfer safe
        require(got > 0, "nothing arrived");
        (address t0, address t1) = _pairOf(token);
        id = locks.length;
        locks.push(Lock(Kind.ERC20, token, got, got, lockOwner, uint64(block.timestamp), unlockAt, vestEnd, t0, t1, false));
        _index(id, lockOwner, token, t0, t1);
        emit Locked(id, lockOwner, Kind.ERC20, token, got, unlockAt, vestEnd, t0, t1);
    }

    /// @notice Lock an ERC-721 (Uniswap V3 position, Uniswap v4 position, or any NFT). Approve the locker first.
    function lockERC721(address collection, uint256 tokenId, uint64 unlockAt, address lockOwner)
        external payable nonReentrant returns (uint256 id)
    {
        require(unlockAt > block.timestamp && unlockAt <= block.timestamp + 3650 days, "unlock time");
        if (lockOwner == address(0)) lockOwner = msg.sender;
        _takeFee();
        IERC721(collection).transferFrom(msg.sender, address(this), tokenId);
        require(IERC721(collection).ownerOf(tokenId) == address(this), "not received");
        (address t0, address t1) = _positionPair(collection, tokenId);
        id = locks.length;
        locks.push(Lock(Kind.ERC721, collection, tokenId, 1, lockOwner, uint64(block.timestamp), unlockAt, unlockAt, t0, t1, false));
        _index(id, lockOwner, collection, t0, t1);
        emit Locked(id, lockOwner, Kind.ERC721, collection, tokenId, unlockAt, unlockAt, t0, t1);
    }

    // ------------------------------------------------------------------ manage
    /// @notice Push the unlock (and vest end) later. Never earlier.
    function extend(uint256 id, uint64 unlockAt, uint64 vestEnd) external onlyLockOwner(id) {
        Lock storage L = locks[id];
        require(!L.withdrawn, "withdrawn");
        require(unlockAt >= L.unlockAt && unlockAt <= block.timestamp + 3650 days, "unlock time");
        if (L.kind == Kind.ERC721) vestEnd = unlockAt;
        require(vestEnd >= unlockAt && vestEnd >= L.vestEnd && vestEnd <= unlockAt + 3650 days, "vest end");
        L.unlockAt = unlockAt; L.vestEnd = vestEnd;
        emit Extended(id, unlockAt, vestEnd);
    }

    function transferLock(uint256 id, address to) external onlyLockOwner(id) {
        require(to != address(0), "zero");
        locks[id].lockOwner = to; _byOwner[to].push(id);
        emit Transferred(id, msg.sender, to);
    }

    /// @notice ERC-20: withdraw whatever has vested. ERC-721: withdraw the NFT after unlock.
    function withdraw(uint256 id, address to) external onlyLockOwner(id) nonReentrant {
        Lock storage L = locks[id];
        require(!L.withdrawn, "withdrawn");
        require(block.timestamp >= L.unlockAt, "locked");
        if (to == address(0)) to = msg.sender;
        if (L.kind == Kind.ERC721) {
            L.withdrawn = true;
            IERC721(L.asset).transferFrom(address(this), to, L.amountOrId);
            emit Withdrawn(id, to, L.amountOrId, true);
            return;
        }
        uint256 rel = _releasable(L);
        require(rel > 0, "nothing vested");
        L.amountOrId -= rel;
        bool complete = L.amountOrId == 0;
        if (complete) L.withdrawn = true;
        require(IERC20(L.asset).transfer(to, rel), "transfer");
        emit Withdrawn(id, to, rel, complete);
    }

    /// @notice Collect swap fees of a locked Uniswap V3 position to `to`. Principal stays locked.
    function collectV3Fees(uint256 id, address to) external onlyLockOwner(id) nonReentrant returns (uint256 a0, uint256 a1) {
        Lock storage L = locks[id];
        require(L.kind == Kind.ERC721 && L.asset == V3_NPM && !L.withdrawn, "not a v3 lock");
        if (to == address(0)) to = msg.sender;
        (a0, a1) = INPMv3(V3_NPM).collect(INPMv3.CollectParams(L.amountOrId, to, type(uint128).max, type(uint128).max));
        emit FeesCollected(id, to, a0, a1);
    }

    // ------------------------------------------------------------------ views
    function count() external view returns (uint256) { return locks.length; }
    function locksOf(address who) external view returns (uint256[] memory) { return _byOwner[who]; }
    function locksForToken(address token) external view returns (uint256[] memory) { return _byToken[token]; }
    function releasable(uint256 id) external view returns (uint256) {
        Lock storage L = locks[id];
        if (L.kind != Kind.ERC20 || L.withdrawn || block.timestamp < L.unlockAt) return 0;
        return _releasable(L);
    }
    function getLocks(uint256[] calldata ids) external view returns (Lock[] memory out) {
        out = new Lock[](ids.length);
        for (uint256 i; i < ids.length; i++) out[i] = locks[ids[i]];
    }

    // ------------------------------------------------------------------ internals
    function _releasable(Lock storage L) internal view returns (uint256) {
        if (block.timestamp < L.unlockAt) return 0;
        if (block.timestamp >= L.vestEnd || L.vestEnd == L.unlockAt) return L.amountOrId;
        // linear: vested share of the initial amount, minus what already left
        uint256 vested = L.initial * (block.timestamp - L.unlockAt) / (L.vestEnd - L.unlockAt);
        uint256 gone = L.initial - L.amountOrId;
        return vested > gone ? vested - gone : 0;
    }
    function _index(uint256 id, address who, address asset, address t0, address t1) internal {
        _byOwner[who].push(id);
        _byToken[asset].push(id);
        if (t0 != address(0) && t0 != asset) _byToken[t0].push(id);
        if (t1 != address(0) && t1 != asset) _byToken[t1].push(id);
    }
    /// V2-style LP token exposes token0()/token1(); a plain token does not → (token, 0)
    function _pairOf(address token) internal view returns (address t0, address t1) {
        (bool ok0, bytes memory d0) = token.staticcall(abi.encodeWithSelector(IUniV2Pair.token0.selector));
        (bool ok1, bytes memory d1) = token.staticcall(abi.encodeWithSelector(IUniV2Pair.token1.selector));
        if (ok0 && ok1 && d0.length == 32 && d1.length == 32) {
            t0 = abi.decode(d0, (address)); t1 = abi.decode(d1, (address));
            if (t0 != address(0) && t1 != address(0)) return (t0, t1);
        }
        return (token, address(0));
    }
    function _positionPair(address collection, uint256 tokenId) internal view returns (address t0, address t1) {
        if (collection == V3_NPM) {
            (, , t0, t1, , , , , , , , ) = INPMv3(V3_NPM).positions(tokenId);
        } else if (collection == V4_POSM) {
            (IPosMv4.PoolKey memory k, ) = IPosMv4(V4_POSM).getPoolAndPositionInfo(tokenId);
            (t0, t1) = (k.currency0, k.currency1);
        } else {
            (t0, t1) = (collection, address(0));
        }
    }

    /// accept ERC-721 safeTransferFrom (positions sent directly are NOT locks — use lockERC721)
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) { return this.onERC721Received.selector; }
    receive() external payable { revert("use lock functions"); }
}
