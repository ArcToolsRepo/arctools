// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ArcPad — ArcTools launchpad on Arc (chain 5042, native USDC gas/value 1e18).
 *
 * - Bonding-curve trading (x*y=k, virtual USDC reserve), no graduation in v1.
 * - Platform fee 1% per trade: 10% of it to ARCT stakers (vault), 90% to treasury.
 * - Per-project taxes chosen at creation: marketing (USDC), rewards (USDC to the
 *   project's own holders, checkpointed), burn (project token to 0xdead).
 * - 5% of every new token's supply -> ArcRewardsVault, claimable pro-rata by
 *   ARCT stakers from a stake snapshot taken at drop block.
 */

interface IERC20 {
    function transfer(address to, uint256 amt) external returns (bool);
    function transferFrom(address from, address to, uint256 amt) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
    function approve(address sp, uint256 amt) external returns (bool);
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256);
}

// ---------------------------------------------------------------- token

contract ArcRewardsVault {
    IERC20 public immutable arct;
    address public launchpad;
    address public immutable owner;

    uint256 public totalStaked;
    mapping(address => uint256) public staked;

    // native USDC fee-share rewards (accumulator)
    uint256 public accUsdc; // scaled 1e18
    uint256 public pendingUsdc;
    mapping(address => uint256) public userAccUsdc;
    mapping(address => uint256) public owedUsdc;

    // stake checkpoints for pro-rata token drops
    struct CP { uint64 blk; uint192 amt; }
    mapping(address => CP[]) public userCP;
    CP[] public totalCP;

    struct Drop { address token; uint64 blk; uint256 amount; uint256 totalAt; }
    Drop[] public drops;
    mapping(uint256 => mapping(address => bool)) public dropClaimed;

    event Staked(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event UsdcClaimed(address indexed user, uint256 amount);
    event TokenDrop(uint256 indexed id, address indexed token, uint256 amount);
    event DropClaimed(uint256 indexed id, address indexed user, uint256 amount);

    constructor(address _arct) {
        arct = IERC20(_arct);
        owner = msg.sender;
    }

    /// @dev v3.1: owner may re-point the vault at a newer launchpad (pad upgrades no longer force stake migration)
    function setLaunchpad(address p) external {
        require(msg.sender == owner, "owner");
        launchpad = p;
    }

    // ---- stake checkpointing ----
    function _push(CP[] storage arr, uint256 amt) internal {
        if (arr.length > 0 && arr[arr.length - 1].blk == uint64(block.number)) {
            arr[arr.length - 1].amt = uint192(amt);
        } else {
            arr.push(CP(uint64(block.number), uint192(amt)));
        }
    }

    function _at(CP[] storage arr, uint64 blk) internal view returns (uint256) {
        uint256 n = arr.length;
        if (n == 0 || arr[0].blk > blk) return 0;
        uint256 lo = 0;
        uint256 hi = n - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (arr[mid].blk <= blk) lo = mid; else hi = mid - 1;
        }
        return arr[lo].amt;
    }

    function _settleUsdc(address u) internal {
        owedUsdc[u] += staked[u] * (accUsdc - userAccUsdc[u]) / 1e18;
        userAccUsdc[u] = accUsdc;
    }

    // ---- staking ----
    function stake(uint256 amount) external {
        require(amount > 0, "zero");
        _settleUsdc(msg.sender);
        uint256 before = arct.balanceOf(address(this));
        require(arct.transferFrom(msg.sender, address(this), amount), "xfer");
        uint256 got = arct.balanceOf(address(this)) - before; // reflection-safe
        staked[msg.sender] += got;
        totalStaked += got;
        _push(userCP[msg.sender], staked[msg.sender]);
        _push(totalCP, totalStaked);
        if (pendingUsdc > 0 && totalStaked > 0) {
            accUsdc += pendingUsdc * 1e18 / totalStaked;
            pendingUsdc = 0;
        }
        emit Staked(msg.sender, got);
    }

    function withdraw(uint256 amount) external {
        require(staked[msg.sender] >= amount, "stake");
        _settleUsdc(msg.sender);
        staked[msg.sender] -= amount;
        totalStaked -= amount;
        _push(userCP[msg.sender], staked[msg.sender]);
        _push(totalCP, totalStaked);
        require(arct.transfer(msg.sender, amount), "xfer");
        emit Withdrawn(msg.sender, amount);
    }

    function claimUsdc() external {
        _settleUsdc(msg.sender);
        uint256 amt = owedUsdc[msg.sender];
        require(amt > 0, "nothing");
        owedUsdc[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "send");
        emit UsdcClaimed(msg.sender, amt);
    }

    function claimableUsdc(address u) external view returns (uint256) {
        return owedUsdc[u] + staked[u] * (accUsdc - userAccUsdc[u]) / 1e18;
    }

    // ---- fee share in (native USDC) ----
    receive() external payable {
        if (totalStaked > 0) accUsdc += msg.value * 1e18 / totalStaked;
        else pendingUsdc += msg.value;
    }

    // ---- token drops (5% supply of each launch) ----
    function notifyTokenDrop(address token, uint256 amount) external {
        require(msg.sender == launchpad, "pad");
        drops.push(Drop(token, uint64(block.number), amount, totalStaked));
        emit TokenDrop(drops.length - 1, token, amount);
    }

    function dropCount() external view returns (uint256) { return drops.length; }

    function claimableDrop(uint256 id, address u) public view returns (uint256) {
        Drop storage d = drops[id];
        if (dropClaimed[id][u]) return 0;
        uint256 tot = d.totalAt > 0 ? d.totalAt : _at(totalCP, d.blk);
        if (tot == 0) return 0;
        uint256 us = _at(userCP[u], d.blk);
        return d.amount * us / tot;
    }

    function claimDrop(uint256 id) external {
        uint256 amt = claimableDrop(id, msg.sender);
        require(amt > 0, "nothing");
        dropClaimed[id][msg.sender] = true;
        require(IERC20(drops[id].token).transfer(msg.sender, amt), "xfer");
        emit DropClaimed(id, msg.sender, amt);
    }
}

// ---------------------------------------------------------------- launchpad

