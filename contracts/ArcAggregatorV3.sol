// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArcAggregator — one swap entry point for every venue on Arc: Uniswap V3 (any fee tier), Uniswap V4
///        (native or facade USDC pools, any hook), ArcToolsPad bonding curves (v2/v3, USDC-quoted) and Warp-style
///        curves. Input/output on the USDC side is always NATIVE USDC (msg.value / native transfer); the ERC-20
///        facade 0x3600… is a view of the same balance, so the contract can pay V3/V4-facade legs from msg.value.
///        Multi-leg = split routing (e.g. 60% V3 / 40% V4). Fee in bps on the USDC side -> immutable treasury.
///        Ownerless, holds no funds between transactions. Includes a revert-based exact-input quoter for V4.
interface IPoolManager {
    struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
    struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

interface ISwapRouter02 {
    struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }
    struct ExactInputParams { bytes path; address recipient; uint256 amountIn; uint256 amountOutMinimum; }
    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256);
    function exactInput(ExactInputParams calldata p) external payable returns (uint256);
}

interface IArcPad {           // ArcToolsPad v2 / v3 (USDC-quoted curves)
    function buy(address token, uint256 minOut) external payable;
    function sell(address token, uint256 amount, uint256 minOut) external;
    function buyToken(address token, uint256 quoteIn, uint256 minOut) external;   // v3.1 ERC-20 quote (wrapped stocks…)
}

interface ICurve {            // generic pump-style curve contract (Warp): payable buy / sell(amount,minOut)
    function buy(uint256 minOut) external payable;
    function sell(uint256 amount, uint256 minOut) external;
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
    function allowance(address o, address s) external view returns (uint256);
}

contract ArcAggregator {
    uint8 public constant VENUE_V3 = 1;
    uint8 public constant VENUE_V4 = 2;
    uint8 public constant VENUE_PAD = 3;     // ArcToolsPad: buy(token,minOut) / sell(token,amount,minOut)
    uint8 public constant VENUE_CURVE = 4;   // generic curve: buy(minOut) / sell(amount,minOut) on `target`
    /// v2: two-hop Uniswap V3 route USDC -(fee)- target(mid) -(key.fee)- token, for tokens quoted in another ERC-20
    ///     (e.g. long.supply memecoins paired with wrapped stocks such as CRCL). Only key.fee of the PoolKey is used.
    uint8 public constant VENUE_V3PATH = 5;
    /// v3: ArcToolsPad curve quoted in an ERC-20 (e.g. a long.supply wrapped stock): USDC -(fee)- quote on V3, then
    ///     pad.buyToken(token, quote, 0); sells reverse it. leg.target = pad, leg.fee = USDC/quote tier, leg.key.currency0 = quote.
    uint8 public constant VENUE_PADQUOTE = 6;

    address public constant USDC_FACADE = 0x3600000000000000000000000000000000000000;
    uint160 private constant MIN_SQRT_PRICE = 4295128739;
    uint160 private constant MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342;

    IPoolManager public immutable poolManager;
    ISwapRouter02 public immutable swapRouter;
    address public immutable treasury;

    /// @param venue  VENUE_*
    /// @param target V3: unused (0) · V4: unused · PAD: launchpad address · CURVE: curve contract
    /// @param fee    V3 fee tier (V4 uses key.fee)
    /// @param key    V4 PoolKey (zeroed otherwise)
    /// @param amount USDC in (buy, native 1e18 units) or tokens in (sell) for THIS leg
    struct Leg { uint8 venue; address target; uint24 fee; IPoolManager.PoolKey key; uint256 amount; }

    event Swapped(address indexed sender, address indexed token, bool buy, uint256 amountIn, uint256 amountOut, uint256 fee, uint8 legs);

    constructor(address _pm, address _router, address _treasury) {
        poolManager = IPoolManager(_pm);
        swapRouter = ISwapRouter02(_router);
        treasury = _treasury;
        IERC20(USDC_FACADE).approve(_router, type(uint256).max);   // pay V3 legs from our native balance
    }

    // ------------------------------------------------------------------ BUY: native USDC -> token
    function buy(address token, Leg[] calldata legs, uint256 minOut, address to, uint16 feeBps) external payable returns (uint256 out) {
        require(feeBps <= 500 && legs.length > 0 && legs.length <= 4, "args");
        uint256 spend;
        for (uint256 i; i < legs.length; i++) spend += legs[i].amount;
        uint256 fee = spend * feeBps / 10_000;
        require(spend + fee <= msg.value, "value");
        uint256 before = IERC20(token).balanceOf(to);
        for (uint256 i; i < legs.length; i++) {
            Leg calldata l = legs[i];
            if (l.venue == VENUE_V3) {
                swapRouter.exactInputSingle(ISwapRouter02.ExactInputSingleParams(USDC_FACADE, token, l.fee, to, l.amount / 1e12, 0, 0));
            } else if (l.venue == VENUE_V3PATH) {
                swapRouter.exactInput(ISwapRouter02.ExactInputParams(abi.encodePacked(USDC_FACADE, l.fee, l.target, l.key.fee, token), to, l.amount / 1e12, 0));
            } else if (l.venue == VENUE_PADQUOTE) {
                address q = l.key.currency0;
                uint256 qGot = swapRouter.exactInputSingle(ISwapRouter02.ExactInputSingleParams(USDC_FACADE, q, l.fee, address(this), l.amount / 1e12, 0, 0));
                _approve(q, l.target, qGot);
                uint256 b = IERC20(token).balanceOf(address(this));
                IArcPad(l.target).buyToken(token, qGot, 0);
                _forward(token, to, IERC20(token).balanceOf(address(this)) - b);
            } else if (l.venue == VENUE_V4) {
                _v4(l.key, token, true, l.amount, to);
            } else if (l.venue == VENUE_PAD) {
                uint256 b = IERC20(token).balanceOf(address(this));
                IArcPad(l.target).buy{value: l.amount}(token, 0);
                _forward(token, to, IERC20(token).balanceOf(address(this)) - b);
            } else if (l.venue == VENUE_CURVE) {
                uint256 b = IERC20(token).balanceOf(address(this));
                ICurve(l.target).buy{value: l.amount}(0);
                _forward(token, to, IERC20(token).balanceOf(address(this)) - b);
            } else revert("venue");
        }
        out = IERC20(token).balanceOf(to) - before;
        require(out >= minOut, "slippage");
        if (fee > 0) _pay(treasury, fee);
        uint256 dust = msg.value - spend - fee;
        if (dust > 0) _pay(msg.sender, dust);
        emit Swapped(msg.sender, token, true, msg.value, out, fee, uint8(legs.length));
    }

    // ------------------------------------------------------------------ SELL: token -> native USDC
    function sell(address token, Leg[] calldata legs, uint256 minOut, address to, uint16 feeBps) external returns (uint256 out) {
        require(feeBps <= 500 && legs.length > 0 && legs.length <= 4, "args");
        uint256 total;
        for (uint256 i; i < legs.length; i++) total += legs[i].amount;
        require(IERC20(token).transferFrom(msg.sender, address(this), total), "pull");
        uint256 before = address(this).balance;
        for (uint256 i; i < legs.length; i++) {
            Leg calldata l = legs[i];
            if (l.venue == VENUE_V3) {
                _approve(token, address(swapRouter), l.amount);
                swapRouter.exactInputSingle(ISwapRouter02.ExactInputSingleParams(token, USDC_FACADE, l.fee, address(this), l.amount, 0, 0));
            } else if (l.venue == VENUE_V3PATH) {
                _approve(token, address(swapRouter), l.amount);
                swapRouter.exactInput(ISwapRouter02.ExactInputParams(abi.encodePacked(token, l.key.fee, l.target, l.fee, USDC_FACADE), address(this), l.amount, 0));
            } else if (l.venue == VENUE_PADQUOTE) {
                address q = l.key.currency0;
                _approve(token, l.target, l.amount);
                uint256 qb = IERC20(q).balanceOf(address(this));
                IArcPad(l.target).sell(token, l.amount, 0);
                uint256 qGot = IERC20(q).balanceOf(address(this)) - qb;
                _approve(q, address(swapRouter), qGot);
                swapRouter.exactInputSingle(ISwapRouter02.ExactInputSingleParams(q, USDC_FACADE, l.fee, address(this), qGot, 0, 0));
            } else if (l.venue == VENUE_V4) {
                _v4(l.key, token, false, l.amount, address(this));
            } else if (l.venue == VENUE_PAD) {
                _approve(token, l.target, l.amount);
                IArcPad(l.target).sell(token, l.amount, 0);
            } else if (l.venue == VENUE_CURVE) {
                _approve(token, l.target, l.amount);
                ICurve(l.target).sell(l.amount, 0);
            } else revert("venue");
        }
        uint256 got = address(this).balance - before;   // facade output IS native balance
        uint256 fee = got * feeBps / 10_000;
        out = got - fee;
        require(out >= minOut, "slippage");
        if (fee > 0) _pay(treasury, fee);
        _pay(to, out);
        emit Swapped(msg.sender, token, false, total, out, fee, uint8(legs.length));
    }

    // ------------------------------------------------------------------ V4 leg + quoter
    struct CB { IPoolManager.PoolKey key; address token; bool isBuy; uint256 amountIn; address to; bool quote; }

    function _v4(IPoolManager.PoolKey calldata key, address token, bool isBuy, uint256 amountIn, address to) internal returns (uint256) {
        bytes memory r = poolManager.unlock(abi.encode(CB(key, token, isBuy, amountIn, to, false)));
        return abi.decode(r, (uint256));
    }

    /// @notice Exact-input quote on a V4 pool via revert trick (call with eth_call).
    function quoteV4(IPoolManager.PoolKey calldata key, address token, bool isBuy, uint256 amountIn) external returns (uint256 out) {
        try poolManager.unlock(abi.encode(CB(key, token, isBuy, amountIn, address(this), true))) {
            revert("no-revert");
        } catch (bytes memory reason) {
            if (reason.length == 32) return abi.decode(reason, (uint256));
            revert("quote");
        }
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "pm");
        CB memory d = abi.decode(raw, (CB));
        address usdc = d.key.currency0 == d.token ? d.key.currency1 : d.key.currency0;
        address cin = d.isBuy ? usdc : d.token;
        address cout = d.isBuy ? d.token : usdc;
        bool zf1 = cin == d.key.currency0;
        bool facadeUsdc = usdc == USDC_FACADE;
        // amounts on the USDC side: facade pools are 6-dec — scale native 1e18 -> 1e6 for buys
        uint256 swapIn = (d.isBuy && facadeUsdc) ? d.amountIn / 1e12 : d.amountIn;
        int256 delta = poolManager.swap(d.key, IPoolManager.SwapParams(zf1, -int256(swapIn), zf1 ? MIN_SQRT_PRICE + 1 : MAX_SQRT_PRICE - 1), "");
        int128 a0 = int128(delta >> 128);
        int128 a1 = int128(delta);
        int128 dIn = zf1 ? a0 : a1;
        int128 dOut = zf1 ? a1 : a0;
        require(dIn <= 0 && dOut >= 0, "delta");
        uint256 owed = uint256(uint128(-dIn));
        uint256 out = uint256(uint128(dOut));
        if (!d.isBuy && facadeUsdc) out = out * 1e12;    // report sells in native units
        if (d.quote) {
            bytes memory enc = abi.encode(out);
            assembly { revert(add(enc, 32), 32) }
        }
        // settle input
        if (cin == address(0)) {
            poolManager.settle{value: owed}();
        } else {
            poolManager.sync(cin);
            require(IERC20(cin).transfer(address(poolManager), owed), "pay");   // facade or token, both held by us
            poolManager.settle();
        }
        // take output
        uint256 takeAmt = (!d.isBuy && facadeUsdc) ? out / 1e12 : out;
        poolManager.take(cout, d.to, takeAmt);
        return abi.encode(out);
    }

    // ------------------------------------------------------------------ helpers
    function _approve(address token, address spender, uint256 amount) internal {
        if (IERC20(token).allowance(address(this), spender) < amount) IERC20(token).approve(spender, type(uint256).max);
    }

    function _forward(address token, address to, uint256 amount) internal {
        if (amount > 0) require(IERC20(token).transfer(to, amount), "fwd");
    }

    function _pay(address to, uint256 amount) internal {
        (bool ok,) = to.call{value: amount}("");
        require(ok, "pay");
    }

    receive() external payable {}
}
