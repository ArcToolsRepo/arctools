// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArcV4Router — minimal, ownerless Uniswap V4 single-hop swap router for Arc.
/// @notice Supports both USDC flavours used as V4 currencies on Arc: native (address(0), 18 dec, msg.value)
///         and the ERC-20 facade (0x3600…, 6 dec, transferFrom). Optional fee in bps on the USDC side goes to
///         the immutable treasury (sniper passes 0 — it charges its own fee; the website passes 100 = 1%).
///         No owner, no upgrade, no sweep: the contract never holds funds between transactions.
interface IPoolManager {
    struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
    struct SwapParams { bool zeroForOne; int256 amountSpecified; uint160 sqrtPriceLimitX96; }
    function unlock(bytes calldata data) external returns (bytes memory);
    function swap(PoolKey memory key, SwapParams memory params, bytes calldata hookData) external returns (int256);
    function sync(address currency) external;
    function settle() external payable returns (uint256);
    function take(address currency, address to, uint256 amount) external;
}

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract ArcV4Router {
    IPoolManager public immutable poolManager;
    address public immutable treasury;
    address public constant USDC_FACADE = 0x3600000000000000000000000000000000000000;
    uint160 private constant MIN_SQRT_PRICE = 4295128739;
    uint160 private constant MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342;

    event Swapped(address indexed sender, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee);

    struct CallbackData {
        address payer;
        address recipient;
        IPoolManager.PoolKey key;
        bool zeroForOne;
        uint256 amountIn;
        uint256 minOut;
        uint16 feeBps;
    }

    constructor(address _poolManager, address _treasury) {
        poolManager = IPoolManager(_poolManager);
        treasury = _treasury;
    }

    function _isUsdc(address c) internal pure returns (bool) { return c == address(0) || c == USDC_FACADE; }

    /// @notice Exact-input single-hop swap. For native input send `amountIn` as msg.value.
    function swapExactIn(IPoolManager.PoolKey calldata key, bool zeroForOne, uint256 amountIn, uint256 minOut,
                         address recipient, uint16 feeBps) external payable returns (uint256 amountOut) {
        require(feeBps <= 500, "fee");
        address cin = zeroForOne ? key.currency0 : key.currency1;
        if (cin == address(0)) require(msg.value == amountIn, "value"); else require(msg.value == 0, "value");
        bytes memory res = poolManager.unlock(abi.encode(CallbackData(msg.sender, recipient, key, zeroForOne, amountIn, minOut, feeBps)));
        amountOut = abi.decode(res, (uint256));
    }

    function unlockCallback(bytes calldata raw) external returns (bytes memory) {
        require(msg.sender == address(poolManager), "pm");
        CallbackData memory d = abi.decode(raw, (CallbackData));
        address cin = d.zeroForOne ? d.key.currency0 : d.key.currency1;
        address cout = d.zeroForOne ? d.key.currency1 : d.key.currency0;

        uint256 fee;
        uint256 swapIn = d.amountIn;
        if (d.feeBps > 0 && _isUsdc(cin)) {           // buy: fee on USDC input
            fee = d.amountIn * d.feeBps / 10_000;
            swapIn = d.amountIn - fee;
            _payFromUser(cin, d.payer, treasury, fee);
        }

        int256 delta = poolManager.swap(d.key,
            IPoolManager.SwapParams(d.zeroForOne, -int256(swapIn), d.zeroForOne ? MIN_SQRT_PRICE + 1 : MAX_SQRT_PRICE - 1), "");
        int128 a0 = int128(delta >> 128);
        int128 a1 = int128(delta);
        int128 dIn = d.zeroForOne ? a0 : a1;      // negative = we owe the pool
        int128 dOut = d.zeroForOne ? a1 : a0;     // positive = pool owes us
        require(dIn <= 0 && dOut >= 0, "delta");
        uint256 owed = uint256(uint128(-dIn));
        uint256 out = uint256(uint128(dOut));

        // settle input
        if (cin == address(0)) {
            poolManager.settle{value: owed}();
        } else {
            poolManager.sync(cin);
            require(IERC20(cin).transferFrom(d.payer, address(poolManager), owed), "pull");
            poolManager.settle();
        }
        // take output (fee on USDC output = sell)
        uint256 outFee;
        if (d.feeBps > 0 && _isUsdc(cout)) {
            outFee = out * d.feeBps / 10_000;
            poolManager.take(cout, treasury, outFee);
            fee = outFee;
        }
        uint256 toUser = out - outFee;
        require(toUser >= d.minOut, "slippage");
        poolManager.take(cout, d.recipient, toUser);
        // refund any unspent native (exact-input, so normally zero)
        if (cin == address(0) && swapIn > owed) {
            (bool ok,) = d.payer.call{value: swapIn - owed}("");
            require(ok, "refund");
        }
        emit Swapped(d.payer, cin, cout, d.amountIn, toUser, fee);
        return abi.encode(toUser);
    }

    function _payFromUser(address currency, address from, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (currency == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            require(ok, "fee xfer");
        } else {
            require(IERC20(currency).transferFrom(from, to, amount), "fee pull");
        }
    }

    receive() external payable {}
}
