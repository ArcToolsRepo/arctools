// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ArcPad v3 — ArcTools launchpad on Arc (chain 5042).
 *
 * New in v3
 *  - quote token per launch: native USDC (address(0)) or ANY ERC-20 that has a
 *    Uniswap V3 pool against USDC (e.g. TOLLY -> "baby TOLLY" trades in TOLLY)
 *  - holder rewards paid in the quote token by default, or in any custom token
 *  - launch modes: curve that graduates at a target (UI presets $5k / $10k) or
 *    instant Uniswap launch (creator seeds the pool, no curve, no taxes)
 *  - graduation: real reserve + matching tokens go into a full-range Uniswap V3
 *    position; the LP NFT is burned (sent to 0xdead) so liquidity is permanent;
 *    leftover curve tokens are burned
 *  - platform fee in a non-USDC quote is pooled and flushed to USDC (10% vault /
 *    90% treasury) via Uniswap — same economics as v2
 *
 * Kept from v2: ArcPadToken (checkpointed holder rewards), ArcRewardsVault
 * (5% of every launch to ARCT stakers), Trade event signature (bots).
 */
interface IERC20 {
    function transfer(address to, uint256 amt) external returns (bool);
    function transferFrom(address from, address to, uint256 amt) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
    function approve(address sp, uint256 amt) external returns (bool);
    function decimals() external view returns (uint8);
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256);
}

interface IUniV3Factory {
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface INonfungiblePositionManager {
    struct MintParams {
        address token0; address token1; uint24 fee; int24 tickLower; int24 tickUpper;
        uint256 amount0Desired; uint256 amount1Desired; uint256 amount0Min; uint256 amount1Min;
        address recipient; uint256 deadline;
    }
    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96)
        external payable returns (address pool);
    function mint(MintParams calldata p) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

interface IVault {
    function notifyTokenDrop(address token, uint256 amount) external;
}

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
        name = n; symbol = s; launchpad = pad;
        totalSupply = supply; balanceOf[pad] = supply;
        emit Transfer(address(0), pad, supply);
    }
    function _move(address from, address to, uint256 amt) internal {
        require(balanceOf[from] >= amt, "balance");
        ArcPadLaunchpadV3(payable(launchpad)).checkpoint(address(this), from, to);
        unchecked { balanceOf[from] -= amt; balanceOf[to] += amt; }
        emit Transfer(from, to, amt);
    }
    function transfer(address to, uint256 amt) external returns (bool) { _move(msg.sender, to, amt); return true; }
    function approve(address sp, uint256 amt) external returns (bool) {
        allowance[msg.sender][sp] = amt; emit Approval(msg.sender, sp, amt); return true;
    }
    function transferFrom(address from, address to, uint256 amt) external returns (bool) {
        uint256 al = allowance[from][msg.sender];
        if (al != type(uint256).max) { require(al >= amt, "allowance"); allowance[from][msg.sender] = al - amt; }
        _move(from, to, amt); return true;
    }
}

contract ArcPadLaunchpadV3 {
    uint256 public constant SUPPLY = 1_000_000_000e18;
    uint256 public constant LOCK_BPS = 500;       // 5% of supply -> ARCT stakers
    uint256 public constant FEE_BPS = 100;        // 1% platform fee per curve trade
    uint256 public constant HOLDER_SHARE = 1000;  // 10% of the fee -> vault
    uint256 public constant MAX_TAX_EACH = 1000;
    uint256 public constant MAX_TAX_TOTAL = 1500;
    uint24  public constant POOL_FEE = 10000;     // graduation pool tier (1%)
    int24   public constant TICK_LOWER = -887200; // full range for tickSpacing 200
    int24   public constant TICK_UPPER = 887200;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public constant USDC_FACADE = 0x3600000000000000000000000000000000000000;
    ISwapRouter02 public constant ROUTER = ISwapRouter02(0x53BF6B0684Ec7eF91e1387Da3D1a1769bC5A6F77);
    IUniV3Factory public constant FACTORY = IUniV3Factory(0xf0db7b58379503491d857dB50AC9ece64c653918);
    INonfungiblePositionManager public constant NPM = INonfungiblePositionManager(0x39654A85A4C05127f5Fd6ED22CAeC077A0fB1377);

    address public immutable treasury;
    IVault public immutable vault;
    address public owner;
    uint256 public minTarget = 100e18;    // min graduation target / instant seed, in quote units (owner-tunable)
    uint256 public instantFee = 30e18;    // flat launch fee for Instant mode, native USDC -> treasury (owner-tunable)

    enum Mode { Curve, Instant }

    struct Meta {
        address token; address creator; address marketingWallet;
        uint16 marketingBps; uint16 rewardsBps; uint16 burnBps;
        string website; string twitter; string telegram;
        uint64 createdAt;
        address rewardToken;   // address(0) = paid in the quote token
    }
    struct Launch {
        address quoteToken;    // address(0) = native USDC
        uint24  quoteTier;     // USDC/quote pool tier (for fee flush + pricing); 0 for USDC quote
        Mode    mode;
        uint256 targetQuote;   // curve: graduation target (real reserve); instant: initial seed
        uint256 virtualQuote;  // curve: virtual reserve
        bool    graduated;
        address pool;          // Uniswap V3 pool after graduation / instant
        uint256 lpTokenId;
    }
    struct Curve { uint256 quoteReserve; uint256 tokenReserve; uint256 volumeQuote; uint64 txCount; }

    struct CreateParams {
        string name; string symbol;
        uint16 marketingBps; uint16 rewardsBps; uint16 burnBps;
        address marketingWallet;
        string website; string twitter; string telegram;
        address rewardToken;
        address quoteToken;
        uint8   mode;
        uint256 targetQuote;   // curve target OR instant seed amount (quote units, 1e18 for native)
    }

    address[] public tokens;
    mapping(address => Meta) public meta;
    mapping(address => Launch) public launch;
    mapping(address => Curve) public curve;
    mapping(address => uint256) public feePot;          // quoteToken -> pooled platform fee (ERC-20 quotes)

    mapping(address => uint256) public rewardsAcc;
    mapping(address => uint256) public rewardsPending;
    mapping(address => mapping(address => uint256)) public userAcc;
    mapping(address => mapping(address => uint256)) public owed;

    event TokenCreated(address indexed token, address indexed creator, string name, string symbol);
    event Trade(address indexed token, address indexed trader, bool buy,
                uint256 usdcIn, uint256 usdcOut, uint256 tokensIn, uint256 tokensOut); // quote units
    event Graduated(address indexed token, address indexed pool, uint256 quoteIn, uint256 tokensIn, uint256 lpTokenId);
    event HolderRewards(address indexed token, uint256 amount);
    event RewardsClaimed(address indexed token, address indexed user, uint256 amount);
    event FeesFlushed(address indexed quote, uint256 quoteIn, uint256 usdcOut);
    event InstantFee(address indexed token, address indexed creator, uint256 fee);

    modifier onlyOwner() { require(msg.sender == owner, "owner"); _; }

    constructor(address _vault, address _treasury) {
        vault = IVault(_vault); treasury = _treasury; owner = msg.sender;
        IERC20(USDC_FACADE).approve(address(ROUTER), type(uint256).max);
        IERC20(USDC_FACADE).approve(address(NPM), type(uint256).max);
    }

    function setMinTarget(uint256 v) external onlyOwner { minTarget = v; }
    function setInstantFee(uint256 v) external onlyOwner { require(v <= 500e18, "max 500"); instantFee = v; }
    function transferOwnership(address o) external onlyOwner { owner = o; }
    function tokenCount() external view returns (uint256) { return tokens.length; }

    // ------------------------------------------------------------ helpers
    function _isUsdc(address q) internal pure returns (bool) { return q == address(0) || q == USDC_FACADE; }

    /// @dev USDC amounts are 1e18 natively but the facade/pool sees 6 decimals.
    function _ercAmount(address quote, uint256 amt) internal pure returns (uint256) {
        return _isUsdc(quote) ? amt / 1e12 : amt;
    }
    function _quoteErc(address quote) internal pure returns (address) { return _isUsdc(quote) ? USDC_FACADE : quote; }

    function _pull(address quote, address from, uint256 amt) internal {
        if (_isUsdc(quote)) { require(msg.value >= amt, "value"); return; }
        require(IERC20(quote).transferFrom(from, address(this), amt), "pull");
    }
    function _push(address quote, address to, uint256 amt) internal {
        if (amt == 0) return;
        if (_isUsdc(quote)) { (bool ok, ) = to.call{value: amt}(""); require(ok, "send"); }
        else require(IERC20(quote).transfer(to, amt), "push");
    }

    function _findTier(address a, address b) internal view returns (uint24) {
        uint24[4] memory tiers = [uint24(10000), 3000, 500, 100];
        for (uint256 i = 0; i < 4; i++) if (FACTORY.getPool(a, b, tiers[i]) != address(0)) return tiers[i];
        return 0;
    }

    /// @dev sqrt(a1/a0) * 2^96 without precision loss for 6-vs-18-decimal pairs; range-checked (Uniswap MIN/MAX).
    function _sqrtPriceX96(uint256 a0, uint256 a1) internal pure returns (uint160) {
        uint256 r = a1 <= type(uint64).max ? _sqrt((a1 << 192) / a0) : _sqrt((a1 << 128) / a0) << 32;
        require(r > 4295128739 && r < 1461446703485210103287273052203988822378723970342, "price range");
        return uint160(r);
    }
    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2; y = x;
        while (z < y) { y = z; z = (x / z + z) / 2; }
    }

    // ------------------------------------------------------------ create
    function createToken(CreateParams calldata p) external payable returns (address token) {
        require(bytes(p.name).length > 0 && bytes(p.name).length <= 48, "name");
        require(bytes(p.symbol).length > 0 && bytes(p.symbol).length <= 12, "symbol");
        require(p.marketingBps <= MAX_TAX_EACH && p.rewardsBps <= MAX_TAX_EACH && p.burnBps <= MAX_TAX_EACH, "tax");
        require(uint256(p.marketingBps) + p.rewardsBps + p.burnBps <= MAX_TAX_TOTAL, "taxsum");
        if (p.marketingBps > 0) require(p.marketingWallet != address(0), "mktwallet");
        require(p.targetQuote >= minTarget, "target");

        address quote = _isUsdc(p.quoteToken) ? address(0) : p.quoteToken;
        uint24 qTier = 0;
        if (quote != address(0)) {
            require(quote.code.length > 0, "quote contract");
            require(IERC20(quote).decimals() == 18, "quote 18 dec");
            qTier = _findTier(quote, USDC_FACADE);
            require(qTier != 0, "no usdc pool");
            IERC20(quote).approve(address(ROUTER), type(uint256).max);
            IERC20(quote).approve(address(NPM), type(uint256).max);
        }
        if (p.rewardToken != address(0)) {
            require(p.rewardsBps > 0, "rewardtoken");
            require(p.rewardToken.code.length > 0, "rewardtoken contract");
            require(p.rewardToken != _quoteErc(quote), "reward=quote");
            require(_findTier(_quoteErc(quote), p.rewardToken) != 0, "no pool");
        }
        Mode mode = Mode(p.mode);
        if (mode == Mode.Instant) require(p.marketingBps == 0 && p.rewardsBps == 0 && p.burnBps == 0, "no taxes");

        token = address(new ArcPadToken(p.name, p.symbol, SUPPLY, address(this)));
        uint256 locked = SUPPLY * LOCK_BPS / 10_000;

        tokens.push(token);
        meta[token] = Meta(token, msg.sender, p.marketingWallet, p.marketingBps, p.rewardsBps, p.burnBps,
                           p.website, p.twitter, p.telegram, uint64(block.timestamp), p.rewardToken);
        launch[token] = Launch(quote, qTier, mode, p.targetQuote, p.targetQuote * 3 / 5, false, address(0), 0);

        ArcPadToken(token).transfer(address(vault), locked);
        vault.notifyTokenDrop(token, locked);
        emit TokenCreated(token, msg.sender, p.name, p.symbol);

        if (mode == Mode.Curve) {
            curve[token] = Curve(p.targetQuote * 3 / 5, SUPPLY - locked, 0, 0);
            require(msg.value == 0, "curve: no value");
        } else {
            // instant: flat fee (native USDC) + creator seeds the pool with targetQuote of quote
            uint256 needValue = instantFee + (quote == address(0) ? p.targetQuote : 0);
            require(msg.value == needValue, "value");
            if (instantFee > 0) {
                (bool okf, ) = treasury.call{value: instantFee}("");
                require(okf, "fee");
                emit InstantFee(token, msg.sender, instantFee);
            }
            _pull(quote, msg.sender, p.targetQuote);
            _graduate(token, p.targetQuote, SUPPLY - locked);
        }
    }

    // ------------------------------------------------------------ quotes
    function quoteBuy(address token, uint256 quoteIn) public view returns (uint256 out) {
        Curve storage c = curve[token]; Meta storage m = meta[token];
        uint256 inNet = quoteIn - quoteIn * FEE_BPS / 10_000;
        inNet -= inNet * (uint256(m.marketingBps) + m.rewardsBps) / 10_000;
        uint256 gross = c.tokenReserve - (c.quoteReserve * c.tokenReserve) / (c.quoteReserve + inNet);
        out = gross - gross * m.burnBps / 10_000;
    }
    function quoteSell(address token, uint256 tokensIn) public view returns (uint256 out) {
        Curve storage c = curve[token]; Meta storage m = meta[token];
        uint256 inNet = tokensIn - tokensIn * m.burnBps / 10_000;
        uint256 gross = c.quoteReserve - (c.quoteReserve * c.tokenReserve) / (c.tokenReserve + inNet);
        uint256 afterFee = gross - gross * FEE_BPS / 10_000;
        out = afterFee - afterFee * (uint256(m.marketingBps) + m.rewardsBps) / 10_000;
    }

    // ------------------------------------------------------------ fees & taxes
    function _platformFee(address quote, uint256 gross) internal returns (uint256 fee) {
        fee = gross * FEE_BPS / 10_000;
        if (_isUsdc(quote)) {
            uint256 holders = fee * HOLDER_SHARE / 10_000;
            (bool ok1, ) = address(vault).call{value: holders}("");
            (bool ok2, ) = treasury.call{value: fee - holders}("");
            require(ok1 && ok2, "fee");
        } else {
            feePot[quote] += fee;          // flushed to USDC by anyone via flushFees()
        }
    }

    /// @notice Swap the pooled platform fee of an ERC-20 quote into USDC and split 10/90. Anyone may call.
    function flushFees(address quote) external {
        uint256 pot = feePot[quote];
        require(pot > 0, "empty");
        uint24 tier = 0;
        for (uint256 i = 0; i < tokens.length && tier == 0; i++) if (launch[tokens[i]].quoteToken == quote) tier = launch[tokens[i]].quoteTier;
        require(tier != 0, "tier");
        feePot[quote] = 0;
        uint256 before = address(this).balance;
        ROUTER.exactInputSingle(ISwapRouter02.ExactInputSingleParams(quote, USDC_FACADE, tier, address(this), pot, 0, 0));
        uint256 got = address(this).balance - before;   // facade output == native balance on Arc
        uint256 holders = got * HOLDER_SHARE / 10_000;
        (bool ok1, ) = address(vault).call{value: holders}("");
        (bool ok2, ) = treasury.call{value: got - holders}("");
        require(ok1 && ok2, "fee");
        emit FeesFlushed(quote, pot, got);
    }

    function _projectTaxes(address token, uint256 amt) internal returns (uint256 taken) {
        Meta storage m = meta[token]; address quote = launch[token].quoteToken;
        uint256 mkt = amt * m.marketingBps / 10_000;
        uint256 rew = amt * m.rewardsBps / 10_000;
        if (mkt > 0) _push(quote, m.marketingWallet, mkt);
        if (rew > 0) { rewardsPending[token] += rew; _flushRewards(token); emit HolderRewards(token, rew); }
        taken = mkt + rew;
    }

    function _circulating(address token) internal view returns (uint256) {
        ArcPadToken t = ArcPadToken(token);
        uint256 c = SUPPLY - t.balanceOf(address(this)) - t.balanceOf(DEAD) - t.balanceOf(address(vault));
        address pool = launch[token].pool;
        if (pool != address(0)) c -= t.balanceOf(pool);   // pool inventory does not earn rewards
        return c;
    }

    function _flushRewards(address token) internal {
        uint256 pot = rewardsPending[token];
        if (pot == 0) return;
        uint256 circ = _circulating(token);
        if (circ == 0) return;
        Meta storage m = meta[token]; address quote = launch[token].quoteToken;
        if (m.rewardToken == address(0)) {            // rewards in the quote token itself
            rewardsPending[token] = 0;
            rewardsAcc[token] += pot * 1e18 / circ;
            return;
        }
        address qErc = _quoteErc(quote);
        uint24 tier = _findTier(qErc, m.rewardToken);
        if (tier == 0) return;
        try ROUTER.exactInputSingle(ISwapRouter02.ExactInputSingleParams(
            qErc, m.rewardToken, tier, address(this), _ercAmount(quote, pot), 0, 0
        )) returns (uint256 got) {
            if (got > 0) { rewardsPending[token] = 0; rewardsAcc[token] += got * 1e18 / circ; }
        } catch {}
    }
    function flushRewards(address token) external { require(meta[token].token == token, "unknown"); _flushRewards(token); }

    // ------------------------------------------------------------ trading (curve phase)
    function buy(address token, uint256 minOut) external payable { _buy(token, msg.value, minOut); }
    function buyToken(address token, uint256 quoteIn, uint256 minOut) external { _buy(token, quoteIn, minOut); }

    function _buy(address token, uint256 quoteIn, uint256 minOut) internal {
        require(quoteIn > 0, "zero");
        Curve storage c = curve[token]; Launch storage L = launch[token];
        require(c.tokenReserve > 0 && !L.graduated, "not on curve");
        _pull(L.quoteToken, msg.sender, quoteIn);

        uint256 fee = _platformFee(L.quoteToken, quoteIn);
        uint256 afterFee = quoteIn - fee;
        uint256 taxes = _projectTaxes(token, afterFee);
        uint256 inNet = afterFee - taxes;

        uint256 gross = c.tokenReserve - (c.quoteReserve * c.tokenReserve) / (c.quoteReserve + inNet);
        uint256 burnAmt = gross * meta[token].burnBps / 10_000;
        uint256 out = gross - burnAmt;
        require(out >= minOut, "slippage");

        c.quoteReserve += inNet; c.tokenReserve -= gross; c.volumeQuote += quoteIn; c.txCount += 1;
        if (burnAmt > 0) ArcPadToken(token).transfer(DEAD, burnAmt);
        ArcPadToken(token).transfer(msg.sender, out);
        emit Trade(token, msg.sender, true, quoteIn, 0, 0, out);

        if (c.quoteReserve - L.virtualQuote >= L.targetQuote) _graduateFromCurve(token);
    }

    function sell(address token, uint256 tokensIn, uint256 minOut) external {
        require(tokensIn > 0, "zero");
        Curve storage c = curve[token]; Launch storage L = launch[token];
        require(c.tokenReserve > 0 && !L.graduated, "not on curve");
        ArcPadToken(token).transferFrom(msg.sender, address(this), tokensIn);

        uint256 burnAmt = tokensIn * meta[token].burnBps / 10_000;
        if (burnAmt > 0) ArcPadToken(token).transfer(DEAD, burnAmt);
        uint256 inNet = tokensIn - burnAmt;

        uint256 gross = c.quoteReserve - (c.quoteReserve * c.tokenReserve) / (c.tokenReserve + inNet);
        require(gross <= c.quoteReserve - L.virtualQuote, "liquidity");
        c.tokenReserve += inNet; c.quoteReserve -= gross; c.volumeQuote += gross; c.txCount += 1;

        uint256 fee = _platformFee(L.quoteToken, gross);
        uint256 afterFee = gross - fee;
        uint256 taxes = _projectTaxes(token, afterFee);
        uint256 out = afterFee - taxes;
        require(out >= minOut, "slippage");
        _push(L.quoteToken, msg.sender, out);
        emit Trade(token, msg.sender, false, 0, out, tokensIn, 0);
    }

    // ------------------------------------------------------------ graduation
    function _graduateFromCurve(address token) internal {
        Curve storage c = curve[token]; Launch storage L = launch[token];
        uint256 real = c.quoteReserve - L.virtualQuote;
        // tokens priced at the curve's final price: real / p = real * tokenReserve / quoteReserve
        uint256 tokensForPool = real * c.tokenReserve / c.quoteReserve;
        uint256 leftover = c.tokenReserve - tokensForPool;
        c.tokenReserve = 0; c.quoteReserve = 0;     // curve closed
        if (leftover > 0) ArcPadToken(token).transfer(DEAD, leftover);
        _graduate(token, real, tokensForPool);
    }

    function _graduate(address token, uint256 quoteAmt, uint256 tokenAmt) internal {
        Launch storage L = launch[token];
        address qErc = _quoteErc(L.quoteToken);
        uint256 qAmt = _ercAmount(L.quoteToken, quoteAmt);
        ArcPadToken(token).approve(address(NPM), tokenAmt);

        (address t0, address t1, uint256 a0, uint256 a1) = token < qErc
            ? (token, qErc, tokenAmt, qAmt) : (qErc, token, qAmt, tokenAmt);
        address pool = NPM.createAndInitializePoolIfNecessary(t0, t1, POOL_FEE, _sqrtPriceX96(a0, a1));
        (uint256 lpId, , uint256 used0, uint256 used1) = NPM.mint(INonfungiblePositionManager.MintParams(
            t0, t1, POOL_FEE, TICK_LOWER, TICK_UPPER, a0, a1, 0, 0, DEAD, block.timestamp));
        // dust not taken by the position: tokens burned, quote to treasury
        uint256 dustTok = token < qErc ? a0 - used0 : a1 - used1;
        uint256 dustQ = token < qErc ? a1 - used1 : a0 - used0;
        if (dustTok > 0) ArcPadToken(token).transfer(DEAD, dustTok);
        if (dustQ > 0) _push(L.quoteToken, treasury, _isUsdc(L.quoteToken) ? dustQ * 1e12 : dustQ);
        L.graduated = true; L.pool = pool; L.lpTokenId = lpId;
        emit Graduated(token, pool, quoteAmt, tokenAmt, lpId);
    }

    // ------------------------------------------------------------ holder rewards
    function checkpoint(address token, address a, address b) external {
        require(msg.sender == token, "token");
        if (meta[token].token != token) return;
        _settle(token, a); _settle(token, b);
    }
    function _settle(address token, address u) internal {
        if (u == address(this) || u == DEAD || u == address(vault) || u == address(0) || u == launch[token].pool) return;
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
        if (rt == address(0)) _push(launch[token].quoteToken, msg.sender, amt);
        else require(IERC20(rt).transfer(msg.sender, amt), "xfer");
        emit RewardsClaimed(token, msg.sender, amt);
    }

    // ------------------------------------------------------------ views
    function tokenPage(address token) external view returns (Meta memory m, Curve memory c, uint256 pricePer1M, Launch memory l) {
        m = meta[token]; c = curve[token]; l = launch[token];
        if (c.tokenReserve > 0) pricePer1M = c.quoteReserve * 1_000_000e18 / c.tokenReserve;
    }
    function list(uint256 offset, uint256 limit) external view returns (address[] memory addrs, Curve[] memory curves, Launch[] memory launches) {
        uint256 n = tokens.length;
        if (offset >= n) return (new address[](0), new Curve[](0), new Launch[](0));
        uint256 end = offset + limit > n ? n : offset + limit;
        addrs = new address[](end - offset); curves = new Curve[](end - offset); launches = new Launch[](end - offset);
        for (uint256 i = offset; i < end; i++) { addrs[i - offset] = tokens[i]; curves[i - offset] = curve[tokens[i]]; launches[i - offset] = launch[tokens[i]]; }
    }
    receive() external payable {}
}
