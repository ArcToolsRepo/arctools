// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * ArcOrders — non-custodial limit / take-profit / stop-loss orders for ArcTools.
 *
 * The maker signs an EIP-712 Order in the browser (no gas). Funds stay in the maker's wallet; the maker only grants
 * this contract an allowance (USDC facade for buys, the token for sells). A whitelisted keeper watches the market
 * and calls execute() when the maker's trigger is met. Execution is routed through ArcAggregatorV3 with the maker
 * as recipient, and the contract REFUSES any fill worse than the maker's signed minRate — the keeper cannot
 * front-run the maker's price, it can only decide *when* to fill inside the maker's limits.
 *
 * Rates are fixed-point 1e18:
 *   buy : minRate = minimum token units received per 1e18 (=1) USDC spent      → out ≥ amountIn * minRate / 1e18
 *   sell: minRate = minimum USDC (1e18) received per 1e18 token units, after fee → out ≥ amountIn * minRate / 1e18
 *
 * Fee: feeBps (default 1%) collected by the aggregator into the treasury on every fill (same as the sniper bot).
 * Nothing is custodied: this contract's balance is zero between transactions (dust refunds are forwarded).
 */

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address a) external view returns (uint256);
}

interface IPoolManager { struct PoolKey { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; } }

interface IArcAggregator {
    struct Leg { uint8 venue; address target; uint24 fee; IPoolManager.PoolKey key; uint256 amount; }
    function buy(address token, Leg[] calldata legs, uint256 minOut, address to, uint16 feeBps) external payable returns (uint256);
    function sell(address token, Leg[] calldata legs, uint256 minOut, address to, uint16 feeBps) external returns (uint256);
}

contract ArcOrders {
    address public constant USDC_FACADE = 0x3600000000000000000000000000000000000000;

    struct Order {
        address maker;
        address token;
        bool    isBuy;
        uint256 amountIn;   // buy: USDC to spend (1e18, fee added on top) · sell: token units to sell
        uint256 minRate;    // see header
        uint256 expiry;     // unix seconds
        uint256 salt;       // client nonce → unique hash, lets the maker place several orders on one token
    }

    bytes32 public constant ORDER_TYPEHASH = keccak256(
        "Order(address maker,address token,bool isBuy,uint256 amountIn,uint256 minRate,uint256 expiry,uint256 salt)");
    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 public immutable DOMAIN_SEPARATOR;

    IArcAggregator public immutable aggregator;
    address public owner;
    uint16  public feeBps = 100;                 // 1%
    mapping(address => bool) public keepers;
    // 0 = open (or never seen), 1 = filled, 2 = cancelled
    mapping(bytes32 => uint8) public status;

    event Filled(bytes32 indexed hash, address indexed maker, address indexed token, bool isBuy, uint256 amountIn, uint256 amountOut, address keeper);
    event Cancelled(bytes32 indexed hash, address indexed maker);
    event KeeperSet(address keeper, bool on);
    event FeeSet(uint16 feeBps);

    modifier onlyOwner() { require(msg.sender == owner, "owner"); _; }

    constructor(address _aggregator, address _keeper) {
        aggregator = IArcAggregator(_aggregator);
        owner = msg.sender;
        keepers[_keeper] = true;
        DOMAIN_SEPARATOR = keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, keccak256("ArcOrders"), keccak256("1"), block.chainid, address(this)));
    }

    // ------------------------------------------------------------------ views
    function hashOrder(Order calldata o) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(ORDER_TYPEHASH, o.maker, o.token, o.isBuy, o.amountIn, o.minRate, o.expiry, o.salt));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "sig");
        bytes32 r = bytes32(sig[0:32]); bytes32 s = bytes32(sig[32:64]); uint8 v = uint8(sig[64]);
        if (v < 27) v += 27;
        require(uint256(s) <= 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0, "s");
        return ecrecover(digest, v, r, s);
    }

    // ------------------------------------------------------------------ maker
    /// Cancel on-chain (the keeper also honours off-chain cancels; this is the trustless backstop).
    function cancel(Order calldata o) external {
        require(msg.sender == o.maker, "maker");
        bytes32 h = hashOrder(o);
        require(status[h] == 0, "closed");
        status[h] = 2;
        emit Cancelled(h, o.maker);
    }

    // ------------------------------------------------------------------ keeper
    function execute(Order calldata o, bytes calldata sig, IArcAggregator.Leg[] calldata legs) external returns (uint256 out) {
        require(keepers[msg.sender], "keeper");
        bytes32 h = hashOrder(o);
        require(status[h] == 0, "closed");
        require(block.timestamp <= o.expiry, "expired");
        require(o.maker != address(0) && _recover(h, sig) == o.maker, "bad sig");
        _checkLegs(legs, o.amountIn);
        status[h] = 1;
        out = o.isBuy ? _fillBuy(o, legs) : _fillSell(o, legs);
        _refundDust(o.maker);
        emit Filled(h, o.maker, o.token, o.isBuy, o.amountIn, out, msg.sender);
    }

    function _checkLegs(IArcAggregator.Leg[] calldata legs, uint256 amountIn) internal pure {
        require(legs.length > 0 && legs.length <= 4, "legs");
        uint256 sum;
        for (uint256 i; i < legs.length; i++) sum += legs[i].amount;
        require(sum == amountIn, "legs sum");
    }

    /// The USDC facade is a 6-decimals ERC-20 view of the 18-decimals native balance (1 facade unit = 1e12 wei).
    /// amountIn/fee are native (1e18) units; we pull ceil((amountIn+fee)/1e12) facade units and pay the aggregator in native.
    function _fillBuy(Order calldata o, IArcAggregator.Leg[] calldata legs) internal returns (uint256) {
        uint256 fee = o.amountIn * feeBps / 10_000;
        uint256 total = o.amountIn + fee;
        uint256 units = (total + 1e12 - 1) / 1e12;
        require(IERC20(USDC_FACADE).transferFrom(o.maker, address(this), units), "pull usdc");
        require(address(this).balance >= total, "facade");
        return aggregator.buy{value: total}(o.token, legs, o.amountIn * o.minRate / 1e18, o.maker, feeBps);
    }

    function _fillSell(Order calldata o, IArcAggregator.Leg[] calldata legs) internal returns (uint256) {
        require(IERC20(o.token).transferFrom(o.maker, address(this), o.amountIn), "pull token");
        IERC20(o.token).approve(address(aggregator), 0);
        IERC20(o.token).approve(address(aggregator), o.amountIn);
        return aggregator.sell(o.token, legs, o.amountIn * o.minRate / 1e18, o.maker, feeBps);
    }

    /// never custody anything: forward any dust the aggregator refunded
    function _refundDust(address to) internal {
        uint256 bal = address(this).balance;
        if (bal > 0) { (bool ok,) = payable(to).call{value: bal}(""); require(ok, "refund"); }
    }

    // ------------------------------------------------------------------ admin
    function setKeeper(address k, bool on) external onlyOwner { keepers[k] = on; emit KeeperSet(k, on); }
    function setFee(uint16 bps) external onlyOwner { require(bps <= 300, "max 3%"); feeBps = bps; emit FeeSet(bps); }
    function setOwner(address o) external onlyOwner { owner = o; }
    /// Sweep tokens accidentally sent here (the contract should never hold anything).
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        if (token == address(0)) { (bool ok,) = payable(to).call{value: amount}(""); require(ok); }
        else require(_t(token, to, amount), "rescue");
    }
    function _t(address token, address to, uint256 amount) internal returns (bool ok) {
        (ok,) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
    }

    receive() external payable {}
}
