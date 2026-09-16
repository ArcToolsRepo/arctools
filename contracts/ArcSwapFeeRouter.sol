// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArcSwapFeeRouter — 1% service fee wrapper over Uniswap V3 SwapRouter02 on Arc.
/// @notice Site swaps (arctools.fun/token) route here. Buy: USDC in -> fee to treasury ->
///         router -> tokens straight to the user. Sell: tokens in -> router -> USDC -> fee ->
///         rest to the user. Never holds funds between transactions.
interface IERC20 {
    function transfer(address to, uint256 v) external returns (bool);
    function transferFrom(address f, address t, uint256 v) external returns (bool);
    function approve(address s, uint256 v) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
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

contract ArcSwapFeeRouter {
    address public immutable USDC;
    ISwapRouter02 public immutable ROUTER;
    address public owner;
    address public treasury;
    uint16 public feeBps = 100; // 1%

    event Buy(address indexed user, address indexed token, uint256 usdcIn, uint256 fee, uint256 tokensOut);
    event Sell(address indexed user, address indexed token, uint256 tokensIn, uint256 usdcOut, uint256 fee);

    modifier onlyOwner() { require(msg.sender == owner, "owner"); _; }

    constructor(address usdc, address router, address treasury_) {
        USDC = usdc;
        ROUTER = ISwapRouter02(router);
        owner = msg.sender;
        treasury = treasury_;
    }

    // ---- low-level safe token ops (tolerate non-standard ERC20 returns) ----
    function _call(address t, bytes memory d) private {
        (bool ok, bytes memory r) = t.call(d);
        require(ok && (r.length == 0 || abi.decode(r, (bool))), "erc20");
    }
    function _pull(address t, address from, uint256 v) private returns (uint256 got) {
        uint256 b = IERC20(t).balanceOf(address(this));
        _call(t, abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), v));
        got = IERC20(t).balanceOf(address(this)) - b; // fee-on-transfer safe
    }
    function _push(address t, address to, uint256 v) private {
        if (v > 0) _call(t, abi.encodeWithSelector(IERC20.transfer.selector, to, v));
    }
    function _approve(address t, uint256 v) private {
        _call(t, abi.encodeWithSelector(IERC20.approve.selector, address(ROUTER), 0));
        _call(t, abi.encodeWithSelector(IERC20.approve.selector, address(ROUTER), v));
    }

    /// @notice Buy `token` with `usdcIn` USDC (6 dec). Caller approves USDC to this contract first.
    function buy(address token, uint24 poolFee, uint256 usdcIn, uint256 minOut, uint256 deadline)
        external returns (uint256 out)
    {
        require(block.timestamp <= deadline, "expired");
        uint256 got = _pull(USDC, msg.sender, usdcIn);
        uint256 fee = got * feeBps / 10_000;
        _push(USDC, treasury, fee);
        uint256 amountIn = got - fee;
        _approve(USDC, amountIn);
        out = ROUTER.exactInputSingle(ISwapRouter02.ExactInputSingleParams({
            tokenIn: USDC, tokenOut: token, fee: poolFee, recipient: msg.sender,
            amountIn: amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0
        }));
        emit Buy(msg.sender, token, got, fee, out);
    }

    /// @notice Sell `tokensIn` of `token` for USDC. Caller approves `token` to this contract first.
    function sell(address token, uint24 poolFee, uint256 tokensIn, uint256 minOut, uint256 deadline)
        external returns (uint256 usdcToUser)
    {
        require(block.timestamp <= deadline, "expired");
        uint256 got = _pull(token, msg.sender, tokensIn);
        _approve(token, got);
        uint256 before = IERC20(USDC).balanceOf(address(this));
        ROUTER.exactInputSingle(ISwapRouter02.ExactInputSingleParams({
            tokenIn: token, tokenOut: USDC, fee: poolFee, recipient: address(this),
            amountIn: got, amountOutMinimum: minOut, sqrtPriceLimitX96: 0
        }));
        uint256 usdcOut = IERC20(USDC).balanceOf(address(this)) - before;
        uint256 fee = usdcOut * feeBps / 10_000;
        _push(USDC, treasury, fee);
        usdcToUser = usdcOut - fee;
        _push(USDC, msg.sender, usdcToUser);
        emit Sell(msg.sender, token, got, usdcOut, fee);
    }

    // ---- admin ----
    function setTreasury(address t) external onlyOwner { require(t != address(0)); treasury = t; }
    function setFeeBps(uint16 b) external onlyOwner { require(b <= 300, "max 3%"); feeBps = b; }
    function transferOwnership(address o) external onlyOwner { owner = o; }
    /// @notice Anything stranded (should never happen) goes to treasury.
    function rescue(address t) external onlyOwner { _push(t, treasury, IERC20(t).balanceOf(address(this))); }
}
