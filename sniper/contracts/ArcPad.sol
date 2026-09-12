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

contract ArcPadToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public immutable launchpad;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory n, string memory s, uint256 supply, address pad) {
        name = n;
        symbol = s;
        launchpad = pad;
        totalSupply = supply;
        balanceOf[pad] = supply;
        emit Transfer(address(0), pad, supply);
    }

    function _move(address from, address to, uint256 amt) internal {
        require(balanceOf[from] >= amt, "balance");
        // checkpoint holder USDC-rewards before balances change
        ArcPadLaunchpad(payable(launchpad)).checkpoint(address(this), from, to);
        unchecked {
            balanceOf[from] -= amt;
            balanceOf[to] += amt;
        }
        emit Transfer(from, to, amt);
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        _move(msg.sender, to, amt);
        return true;
    }

    function approve(address sp, uint256 amt) external returns (bool) {
        allowance[msg.sender][sp] = amt;
        emit Approval(msg.sender, sp, amt);
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        if (msg.sender != launchpad) {
            uint256 al = allowance[from][msg.sender];
            require(al >= amt, "allowance");
            if (al != type(uint256).max) allowance[from][msg.sender] = al - amt;
        }
        _move(from, to, amt);
        return true;
    }
}

// ---------------------------------------------------------------- vault

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

    function setLaunchpad(address p) external {
        require(msg.sender == owner && launchpad == address(0), "set");
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

contract ArcPadLaunchpad {
    uint256 public constant SUPPLY = 1_000_000_000e18;
    uint256 public constant LOCK_BPS = 500;      // 5% of supply -> vault drop
    uint256 public constant FEE_BPS = 100;       // 1% platform fee per trade
    uint256 public constant HOLDER_SHARE = 1000; // 10% of the fee -> ARCT stakers
    uint256 public constant VIRTUAL_USDC = 3000e18;
    uint256 public constant MAX_TAX_EACH = 1000; // 10% cap per tax
    uint256 public constant MAX_TAX_TOTAL = 1500;

    address public immutable treasury;
    ArcRewardsVault public immutable vault;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public constant USDC_FACADE = 0x3600000000000000000000000000000000000000;
    ISwapRouter02 public constant ROUTER = ISwapRouter02(0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77);

    struct Meta {
        address token;
        address creator;
        address marketingWallet;
        uint16 marketingBps;
        uint16 rewardsBps;
        uint16 burnBps;
        string website;
        string twitter;
        string telegram;
        uint64 createdAt;
        address rewardToken; // address(0) = native USDC
    }

    struct Curve {
        uint256 usdcReserve;   // virtual + real
        uint256 tokenReserve;
        uint256 volumeUsdc;    // cumulative, 1e18
        uint64 txCount;
    }

    address[] public tokens;
    mapping(address => Meta) public meta;
    mapping(address => Curve) public curve;

    // per-project holder rewards (native USDC), checkpointed on token transfers
    mapping(address => uint256) public rewardsAcc;           // token -> acc (1e18)
    mapping(address => uint256) public rewardsPending;       // waiting for circ > 0
    mapping(address => mapping(address => uint256)) public userAcc;   // token -> user
    mapping(address => mapping(address => uint256)) public owed;      // token -> user

    event TokenCreated(address indexed token, address indexed creator, string name, string symbol);
    event Trade(address indexed token, address indexed trader, bool buy,
                uint256 usdcIn, uint256 usdcOut, uint256 tokensIn, uint256 tokensOut);
    event HolderRewards(address indexed token, uint256 usdc);
    event RewardsClaimed(address indexed token, address indexed user, uint256 usdc);

    constructor(address _vault, address _treasury) {
        vault = ArcRewardsVault(payable(_vault));
        treasury = _treasury;
        // router pulls the facade view of native USDC for reward-token swaps
        IERC20(USDC_FACADE).approve(address(ROUTER), type(uint256).max);
    }

    function tokenCount() external view returns (uint256) { return tokens.length; }

    // -------- create --------
    function createToken(
        string calldata name_,
        string calldata symbol_,
        uint16 marketingBps,
        uint16 rewardsBps,
        uint16 burnBps,
        address marketingWallet,
        string calldata website,
        string calldata twitter,
        string calldata telegram,
        address rewardToken
    ) external returns (address token) {
        require(bytes(name_).length > 0 && bytes(name_).length <= 48, "name");
        require(bytes(symbol_).length > 0 && bytes(symbol_).length <= 12, "symbol");
        require(marketingBps <= MAX_TAX_EACH && rewardsBps <= MAX_TAX_EACH && burnBps <= MAX_TAX_EACH, "tax");
        require(uint256(marketingBps) + rewardsBps + burnBps <= MAX_TAX_TOTAL, "taxsum");
        if (marketingBps > 0) require(marketingWallet != address(0), "mktwallet");
        if (rewardToken != address(0)) {
            require(rewardsBps > 0, "rewardtoken");
            require(rewardToken.code.length > 0, "rewardtoken contract");
        }

        token = address(new ArcPadToken(name_, symbol_, SUPPLY, address(this)));
        uint256 locked = SUPPLY * LOCK_BPS / 10_000;

        // register BEFORE any token movement (transfers call back into checkpoint)
        tokens.push(token);
        meta[token] = Meta(token, msg.sender, marketingWallet, marketingBps, rewardsBps,
                           burnBps, website, twitter, telegram, uint64(block.timestamp), rewardToken);
        curve[token] = Curve(VIRTUAL_USDC, SUPPLY - locked, 0, 0);

        ArcPadToken(token).transfer(address(vault), locked);
        vault.notifyTokenDrop(token, locked);
        emit TokenCreated(token, msg.sender, name_, symbol_);
    }

    // -------- quotes --------
    function quoteBuy(address token, uint256 usdcIn) public view returns (uint256 out) {
        Curve storage c = curve[token];
        Meta storage m = meta[token];
        uint256 inNet = usdcIn - usdcIn * FEE_BPS / 10_000;
        inNet -= inNet * (uint256(m.marketingBps) + m.rewardsBps) / 10_000;
        uint256 gross = c.tokenReserve - (c.usdcReserve * c.tokenReserve) / (c.usdcReserve + inNet);
        out = gross - gross * m.burnBps / 10_000;
    }

    function quoteSell(address token, uint256 tokensIn) public view returns (uint256 out) {
        Curve storage c = curve[token];
        Meta storage m = meta[token];
        uint256 inNet = tokensIn - tokensIn * m.burnBps / 10_000;
        uint256 gross = c.usdcReserve - (c.usdcReserve * c.tokenReserve) / (c.tokenReserve + inNet);
        uint256 afterFee = gross - gross * FEE_BPS / 10_000;
        out = afterFee - afterFee * (uint256(m.marketingBps) + m.rewardsBps) / 10_000;
    }

    // -------- internals --------
    function _circulating(address token) internal view returns (uint256) {
        ArcPadToken t = ArcPadToken(token);
        return SUPPLY - t.balanceOf(address(this)) - t.balanceOf(DEAD) - t.balanceOf(address(vault));
    }

    function _platformFee(uint256 gross) internal returns (uint256 fee) {
        fee = gross * FEE_BPS / 10_000;
        uint256 holders = fee * HOLDER_SHARE / 10_000;
        (bool ok1, ) = address(vault).call{value: holders}("");
        (bool ok2, ) = treasury.call{value: fee - holders}("");
        require(ok1 && ok2, "fee");
    }

    function _projectTaxes(address token, uint256 amt) internal returns (uint256 taken) {
        Meta storage m = meta[token];
        uint256 mkt = amt * m.marketingBps / 10_000;
        uint256 rew = amt * m.rewardsBps / 10_000;
        if (mkt > 0) {
            (bool ok, ) = m.marketingWallet.call{value: mkt}("");
            require(ok, "mkt");
        }
        if (rew > 0) {
            rewardsPending[token] += rew;
            _flushRewards(token);
            emit HolderRewards(token, rew);
        }
        taken = mkt + rew;
    }

    /** Convert the pending USDC pot into the reward asset and distribute
     *  to holders via the accumulator. USDC rewards distribute directly;
     *  custom reward tokens are bought on Uniswap V3 (fee 1%). A failed
     *  swap (no pool / thin pool) leaves the pot pending for the next trade. */
    function _flushRewards(address token) internal {
        uint256 pot = rewardsPending[token];
        if (pot == 0) return;
        uint256 circ = _circulating(token);
        if (circ == 0) return;
        Meta storage m = meta[token];
        if (m.rewardToken == address(0)) {
            rewardsPending[token] = 0;
            rewardsAcc[token] += pot * 1e18 / circ;
            return;
        }
        // custom reward token: swap native-USDC pot (facade 6 dec = pot/1e12)
        uint256 amountIn6 = pot / 1e12;
        if (amountIn6 == 0) return;
        try ROUTER.exactInputSingle(ISwapRouter02.ExactInputSingleParams(
            USDC_FACADE, m.rewardToken, 10000, address(this), amountIn6, 0, 0
        )) returns (uint256 got) {
            if (got > 0) {
                rewardsPending[token] = 0;
                rewardsAcc[token] += got * 1e18 / circ;
            }
        } catch {
            // pot stays pending; anyone can retry via flushRewards(token)
        }
    }

    /** Public retry for a stuck custom-reward swap. */
    function flushRewards(address token) external {
        require(meta[token].token == token, "unknown");
        _flushRewards(token);
    }

    // -------- trading --------
    function buy(address token, uint256 minOut) external payable {
        require(msg.value > 0, "zero");
        Curve storage c = curve[token];
        require(c.tokenReserve > 0, "unknown token");
        uint256 fee = _platformFee(msg.value);
        uint256 afterFee = msg.value - fee;
        uint256 taxes = _projectTaxes(token, afterFee);
        uint256 inNet = afterFee - taxes;

        uint256 gross = c.tokenReserve - (c.usdcReserve * c.tokenReserve) / (c.usdcReserve + inNet);
        uint256 burnAmt = gross * meta[token].burnBps / 10_000;
        uint256 out = gross - burnAmt;
        require(out >= minOut, "slippage");

        c.usdcReserve += inNet;
        c.tokenReserve -= gross;
        c.volumeUsdc += msg.value;
        c.txCount += 1;

        if (burnAmt > 0) ArcPadToken(token).transfer(DEAD, burnAmt);
        ArcPadToken(token).transfer(msg.sender, out);
        emit Trade(token, msg.sender, true, msg.value, 0, 0, out);
    }

    function sell(address token, uint256 tokensIn, uint256 minOut) external {
        require(tokensIn > 0, "zero");
        Curve storage c = curve[token];
        require(c.tokenReserve > 0, "unknown token");
        ArcPadToken(token).transferFrom(msg.sender, address(this), tokensIn);

        uint256 burnAmt = tokensIn * meta[token].burnBps / 10_000;
        if (burnAmt > 0) ArcPadToken(token).transfer(DEAD, burnAmt);
        uint256 inNet = tokensIn - burnAmt;

        uint256 gross = c.usdcReserve - (c.usdcReserve * c.tokenReserve) / (c.tokenReserve + inNet);
        require(gross < c.usdcReserve - VIRTUAL_USDC + 1, "liquidity"); // real USDC only
        c.tokenReserve += inNet;
        c.usdcReserve -= gross;
        c.volumeUsdc += gross;
        c.txCount += 1;

        uint256 fee = _platformFee(gross);
        uint256 afterFee = gross - fee;
        uint256 taxes = _projectTaxes(token, afterFee);
        uint256 out = afterFee - taxes;
        require(out >= minOut, "slippage");
        (bool ok, ) = msg.sender.call{value: out}("");
        require(ok, "send");
        emit Trade(token, msg.sender, false, 0, out, tokensIn, 0);
    }

    // -------- holder rewards (project tokens) --------
    function checkpoint(address token, address a, address b) external {
        require(msg.sender == token, "token");
        if (meta[token].token != token) return; // unknown token: nothing to settle
        _settle(token, a);
        _settle(token, b);
    }

    function _settle(address token, address u) internal {
        if (u == address(this) || u == DEAD || u == address(vault) || u == address(0)) return;
        uint256 bal = ArcPadToken(token).balanceOf(u);
        owed[token][u] += bal * (rewardsAcc[token] - userAcc[token][u]) / 1e18;
        userAcc[token][u] = rewardsAcc[token];
    }

    function claimable(address token, address u) external view returns (uint256) {
        uint256 bal = ArcPadToken(token).balanceOf(u);
        return owed[token][u] + bal * (rewardsAcc[token] - userAcc[token][u]) / 1e18;
    }

    function claimRewards(address token) external {
        _settle(token, msg.sender);
        uint256 amt = owed[token][msg.sender];
        require(amt > 0, "nothing");
        owed[token][msg.sender] = 0;
        address rt = meta[token].rewardToken;
        if (rt == address(0)) {
            (bool ok, ) = msg.sender.call{value: amt}("");
            require(ok, "send");
        } else {
            require(IERC20(rt).transfer(msg.sender, amt), "xfer");
        }
        emit RewardsClaimed(token, msg.sender, amt);
    }

    // -------- views for the site --------
    function tokenPage(address token) external view returns (
        Meta memory m, Curve memory c, uint256 pricePer1M
    ) {
        m = meta[token];
        c = curve[token];
        if (c.tokenReserve > 0) {
            pricePer1M = c.usdcReserve * 1_000_000e18 / c.tokenReserve;
        }
    }

    function list(uint256 offset, uint256 limit) external view returns (
        address[] memory addrs, Curve[] memory curves
    ) {
        uint256 n = tokens.length;
        if (offset >= n) return (new address[](0), new Curve[](0));
        uint256 end = offset + limit > n ? n : offset + limit;
        addrs = new address[](end - offset);
        curves = new Curve[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            addrs[i - offset] = tokens[i];
            curves[i - offset] = curve[tokens[i]];
        }
    }

    receive() external payable {}
}
