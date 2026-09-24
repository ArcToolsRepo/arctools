// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title ArcPerps v1 — 24/7 synthetic perpetuals on Arc, settled in native USDC.
/// @notice Peer-to-pool with a strict cap: traders' PnL is settled against a shared USDC fund that LPs (and the
///         treasury) may seed. Unmatched open interest is limited to a fraction of the fund, so at fund = 0 the market
///         is purely peer-to-peer (a long can only open against existing short interest). Prices come from the ArcTools
///         operator as signed pull-oracle updates (any caller may attach one to its own transaction) — the same model as
///         ArcPredict's price posting, without a standing cost. Markets carry two leverage caps: with a live feed
///         (exchange hours for tokenized stocks, always for Arc pool TWAP) and without one (weekend corridor).
///         Nothing is custodial beyond the escrowed margin; there is no admin withdrawal of user funds.
contract ArcPerps {
    // ───────────────────────── constants / config ─────────────────────────
    uint256 public constant U = 1e18;                 // native USDC has 18 decimals on Arc
    uint256 public constant PRICE_SCALE = 1e8;        // prices are posted with 8 decimals
    uint256 public constant BPS = 10_000;
    uint256 public constant FEE_BPS = 10;             // 0.10 % of notional on open and on close
    uint256 public constant FEE_TO_TREASURY_BPS = 3_000; // 30 % of fees → treasury (buyback + burn); 70 % → fund (LPs)
    uint256 public constant MAINT_MARGIN_BPS = 1_500; // liquidate when equity ≤ 15 % of initial margin
    uint256 public constant LIQ_REWARD_BPS = 50;      // 0.5 % of notional to the liquidator, from the remaining margin
    uint256 public constant UNMATCHED_CAP_BPS = 5_000; // unmatched OI ≤ 50 % of fund
    uint256 public constant MAX_FUNDING_BPS_H = 5;    // ±0.05 % per hour
    uint256 public constant PRICE_MAX_AGE = 120;      // seconds a signed price stays usable
    uint256 public constant MIN_MARGIN = 1 * U;       // 1 USDC
    uint256 public constant LP_LOCK = 24 hours;

    address public admin;
    address public operator;                          // signs price updates
    address public immutable treasury;
    bool public paused;

    // ───────────────────────── markets ─────────────────────────
    struct Market {
        string  name;            // "NVDA-USDC"
        uint8   kind;            // 0 = Arc pool TWAP, 1 = tokenized stock (external feed with schedule)
        uint16  maxLevLive;      // e.g. 3
        uint16  maxLevOff;       // e.g. 2 (stock weekend); for kind 0 equal to maxLevLive
        uint16  corridorBps;     // off-feed price must stay within ±corridor of lastLivePrice (stocks: 700 = 7 %)
        uint128 oiCap;           // max open interest per side (USDC notional, 18 dec)
        bool    active;          // false = no new opens, closes still allowed
        // oracle state
        uint128 price;           // last accepted price (8 dec)
        uint64  priceTs;         // its timestamp
        bool    feedLive;        // flag carried by the last update
        uint128 lastLivePrice;   // last price accepted with feedLive = true (corridor anchor)
        // interest + funding
        uint128 longOI;          // USDC notional (18 dec)
        uint128 shortOI;
        int256  fundingIndexLong;   // cumulative, 18-dec fraction of notional (positive = longs paid)
        int256  fundingIndexShort;
        uint64  lastFunding;
    }
    Market[] public markets;

    struct Position {
        address owner;
        uint32  market;
        bool    isLong;
        uint128 margin;          // USDC (18 dec) locked
        uint128 notional;        // USDC (18 dec) at entry = margin × leverage
        uint128 entryPrice;      // 8 dec
        int256  fundingEntry;    // funding index of its side at entry
        uint64  openedAt;
    }
    Position[] public positions;                     // id = index; closed positions keep owner = 0
    mapping(address => uint256[]) private _userPositions;

    // ───────────────────────── fund (LP) ─────────────────────────
    uint256 public fund;                  // USDC available to absorb trader PnL and pay fees to LPs
    uint256 public fundShares;            // total LP shares
    mapping(address => uint256) public shares;
    mapping(address => uint64) public lpUnlockAt;
    uint256 public badDebt;               // losses the fund could not cover (informational; socialized on LPs implicitly)

    // ───────────────────────── events ─────────────────────────
    event MarketAdded(uint256 indexed id, string name, uint8 kind, uint16 maxLevLive, uint16 maxLevOff, uint128 oiCap);
    event MarketUpdated(uint256 indexed id, bool active, uint16 maxLevLive, uint16 maxLevOff, uint128 oiCap, uint16 corridorBps);
    event PricePosted(uint256 indexed market, uint128 price, bool feedLive, uint64 ts);
    event Opened(uint256 indexed id, address indexed owner, uint256 indexed market, bool isLong, uint128 margin, uint128 notional, uint128 price, uint256 fee);
    event Closed(uint256 indexed id, address indexed owner, uint128 price, int256 pnl, int256 funding, uint256 fee, uint256 payout, bool liquidated, address liquidator);
    event FundingAccrued(uint256 indexed market, int256 ratePerHourBps, int256 indexLong, int256 indexShort);
    event LpDeposit(address indexed lp, uint256 amount, uint256 shares);
    event LpWithdraw(address indexed lp, uint256 amount, uint256 shares);
    event FeeSplit(uint256 toFund, uint256 toTreasury);

    modifier onlyAdmin() { require(msg.sender == admin, "admin"); _; }

    constructor(address _operator, address _treasury) {
        require(_operator != address(0) && _treasury != address(0), "zero");
        admin = msg.sender; operator = _operator; treasury = _treasury;
    }

    // ───────────────────────── admin ─────────────────────────
    function setOperator(address o) external onlyAdmin { require(o != address(0), "zero"); operator = o; }
    function setAdmin(address a) external onlyAdmin { require(a != address(0), "zero"); admin = a; }
    function setPaused(bool p) external onlyAdmin { paused = p; }

    function addMarket(string calldata name, uint8 kind, uint16 maxLevLive, uint16 maxLevOff, uint16 corridorBps, uint128 oiCap) external onlyAdmin returns (uint256 id) {
        require(kind <= 1 && maxLevLive >= 1 && maxLevLive <= 5 && maxLevOff >= 1 && maxLevOff <= maxLevLive, "lev");
        Market memory m; m.name = name; m.kind = kind; m.maxLevLive = maxLevLive; m.maxLevOff = maxLevOff; m.corridorBps = corridorBps; m.oiCap = oiCap; m.active = true; m.lastFunding = uint64(block.timestamp);
        markets.push(m); id = markets.length - 1;
        emit MarketAdded(id, name, kind, maxLevLive, maxLevOff, oiCap);
    }

    function updateMarket(uint256 id, bool active, uint16 maxLevLive, uint16 maxLevOff, uint16 corridorBps, uint128 oiCap) external onlyAdmin {
        require(maxLevLive >= 1 && maxLevLive <= 5 && maxLevOff >= 1 && maxLevOff <= maxLevLive, "lev");
        Market storage m = markets[id]; m.active = active; m.maxLevLive = maxLevLive; m.maxLevOff = maxLevOff; m.corridorBps = corridorBps; m.oiCap = oiCap;
        emit MarketUpdated(id, active, maxLevLive, maxLevOff, oiCap, corridorBps);
    }

    // ───────────────────────── oracle (pull) ─────────────────────────
    /// @notice Anyone may relay an operator-signed price. Signed payload: keccak256(chainId, this, market, price, feedLive, ts).
    function postPrice(uint256 market, uint128 price, bool feedLive, uint64 ts, bytes calldata sig) public {
        Market storage m = markets[market];
        require(price > 0, "price");
        require(ts <= block.timestamp + 15 && ts + PRICE_MAX_AGE >= block.timestamp, "stale");
        require(ts >= m.priceTs, "older");
        bytes32 h = keccak256(abi.encode(block.chainid, address(this), market, price, feedLive, ts));
        require(_recover(h, sig) == operator, "sig");
        if (!feedLive && m.lastLivePrice > 0 && m.corridorBps > 0) {
            // off-feed price (stock weekend / after-hours gap): clamp inside the corridor around the last live price
            uint256 lo = uint256(m.lastLivePrice) * (BPS - m.corridorBps) / BPS;
            uint256 hi = uint256(m.lastLivePrice) * (BPS + m.corridorBps) / BPS;
            if (price < lo) price = uint128(lo);
            if (price > hi) price = uint128(hi);
        }
        _accrueFunding(market);
        m.price = price; m.priceTs = ts; m.feedLive = feedLive;
        if (feedLive) m.lastLivePrice = price;
        emit PricePosted(market, price, feedLive, ts);
    }

    function _recover(bytes32 h, bytes calldata sig) internal pure returns (address) {
        require(sig.length == 65, "siglen");
        bytes32 r; bytes32 s; uint8 v;
        assembly { r := calldataload(sig.offset) s := calldataload(add(sig.offset, 32)) v := byte(0, calldataload(add(sig.offset, 64))) }
        if (v < 27) v += 27;
        return ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h)), v, r, s);
    }

    function _freshPrice(Market storage m) internal view returns (uint128) {
        require(m.price > 0 && m.priceTs + PRICE_MAX_AGE >= block.timestamp, "no fresh price");
        return m.price;
    }

    // ───────────────────────── funding ─────────────────────────
    /// @dev hourly rate = clamp((longOI − shortOI) / max(longOI, shortOI), ±MAX) × MAX_FUNDING; the heavier side pays.
    function _accrueFunding(uint256 id) internal {
        Market storage m = markets[id];
        uint256 elapsed = block.timestamp - m.lastFunding;
        if (elapsed == 0) return;
        if (m.longOI == 0 && m.shortOI == 0) { m.lastFunding = uint64(block.timestamp); return; }
        uint256 hi = m.longOI > m.shortOI ? m.longOI : m.shortOI;
        int256 skew = (int256(uint256(m.longOI)) - int256(uint256(m.shortOI))) * int256(BPS) / int256(hi);   // bps, −10000..10000
        int256 rateBps = skew * int256(MAX_FUNDING_BPS_H) / int256(BPS);                                    // −5..5 bps per hour
        // paid over `elapsed` seconds, as an 18-dec fraction of notional
        int256 delta = rateBps * int256(U) * int256(elapsed) / int256(BPS) / int256(3600);
        // heavier side pays `delta`, lighter side receives delta × heavyOI / lightOI (conserving USDC between sides)
        if (delta > 0) {                                        // longs pay
            m.fundingIndexLong += delta;
            if (m.shortOI > 0) m.fundingIndexShort -= delta * int256(uint256(m.longOI)) / int256(uint256(m.shortOI));
        } else if (delta < 0) {                                 // shorts pay
            m.fundingIndexShort += (-delta);
            if (m.longOI > 0) m.fundingIndexLong -= (-delta) * int256(uint256(m.shortOI)) / int256(uint256(m.longOI));
        }
        m.lastFunding = uint64(block.timestamp);
        emit FundingAccrued(id, rateBps, m.fundingIndexLong, m.fundingIndexShort);
    }

    // ───────────────────────── trading ─────────────────────────
    /// @notice Open a position; msg.value = margin + fee. Attach a price update in the same tx via `postPrice` first, or pass one here.
    function open(uint256 market, bool isLong, uint16 leverage, uint128 price, bool feedLive, uint64 ts, bytes calldata sig) external payable returns (uint256 id) {
        require(!paused, "paused");
        Market storage m = markets[market];
        require(m.active, "market closed");
        if (sig.length > 0) postPrice(market, price, feedLive, ts, sig); else _accrueFunding(market);
        uint128 px = _freshPrice(m);
        uint16 maxLev = m.feedLive ? m.maxLevLive : m.maxLevOff;
        require(leverage >= 1 && leverage <= maxLev, "leverage");
        // fee is charged on notional; msg.value covers margin + fee
        uint256 margin = msg.value * BPS / (BPS + FEE_BPS * leverage);
        require(margin >= MIN_MARGIN, "min margin");
        uint256 notional = margin * leverage;
        uint256 fee = msg.value - margin;
        // exposure checks
        if (isLong) {
            require(m.longOI + notional <= m.oiCap, "oi cap");
            uint256 unmatched = m.longOI + notional > m.shortOI ? m.longOI + notional - m.shortOI : 0;
            require(unmatched <= fund * UNMATCHED_CAP_BPS / BPS, "no counterparty");
            m.longOI += uint128(notional);
        } else {
            require(m.shortOI + notional <= m.oiCap, "oi cap");
            uint256 unmatched = m.shortOI + notional > m.longOI ? m.shortOI + notional - m.longOI : 0;
            require(unmatched <= fund * UNMATCHED_CAP_BPS / BPS, "no counterparty");
            m.shortOI += uint128(notional);
        }
        positions.push(Position({ owner: msg.sender, market: uint32(market), isLong: isLong, margin: uint128(margin), notional: uint128(notional), entryPrice: px,
                                  fundingEntry: isLong ? m.fundingIndexLong : m.fundingIndexShort, openedAt: uint64(block.timestamp) }));
        id = positions.length - 1;
        _userPositions[msg.sender].push(id);
        _splitFee(fee);
        emit Opened(id, msg.sender, market, isLong, uint128(margin), uint128(notional), px, fee);
    }

    /// @notice Close your own position at the fresh mark. Attach a price update if the on-chain one is stale.
    function close(uint256 id, uint128 price, bool feedLive, uint64 ts, bytes calldata sig) external {
        Position storage p = positions[id];
        require(p.owner == msg.sender, "not owner");
        if (sig.length > 0) postPrice(p.market, price, feedLive, ts, sig); else _accrueFunding(p.market);
        _settle(id, false, address(0));
    }

    /// @notice Liquidate anyone whose equity fell to the maintenance level. Liquidator earns 0.5 % of notional.
    function liquidate(uint256 id, uint128 price, bool feedLive, uint64 ts, bytes calldata sig) external {
        Position storage p = positions[id];
        require(p.owner != address(0), "closed");
        if (sig.length > 0) postPrice(p.market, price, feedLive, ts, sig); else _accrueFunding(p.market);
        (int256 equity,,) = _equity(id, _freshPrice(markets[p.market]));
        require(equity <= int256(uint256(p.margin) * MAINT_MARGIN_BPS / BPS), "healthy");
        _settle(id, true, msg.sender);
    }

    /// @dev pnl and funding in USDC (18 dec, signed); equity = margin + pnl − funding
    function _equity(uint256 id, uint128 px) internal view returns (int256 equity, int256 pnl, int256 fundingPaid) {
        Position storage p = positions[id];
        Market storage m = markets[p.market];
        int256 diff = int256(uint256(px)) - int256(uint256(p.entryPrice));
        pnl = int256(uint256(p.notional)) * diff / int256(uint256(p.entryPrice));
        if (!p.isLong) pnl = -pnl;
        int256 idx = p.isLong ? m.fundingIndexLong : m.fundingIndexShort;
        fundingPaid = int256(uint256(p.notional)) * (idx - p.fundingEntry) / int256(U);
        equity = int256(uint256(p.margin)) + pnl - fundingPaid;
    }

    function _settle(uint256 id, bool liquidated, address liquidator) internal {
        Position storage p = positions[id];
        Market storage m = markets[p.market];
        uint128 px = _freshPrice(m);
        (int256 equity, int256 pnl, int256 fundingPaid) = _equity(id, px);
        uint256 fee = uint256(p.notional) * FEE_BPS / BPS;
        uint256 payout;
        if (equity > int256(fee)) payout = uint256(equity) - fee; else { fee = equity > 0 ? uint256(equity) : 0; payout = 0; }
        uint256 liqReward;
        if (liquidated && payout > 0) { liqReward = uint256(p.notional) * LIQ_REWARD_BPS / BPS; if (liqReward > payout) liqReward = payout; payout -= liqReward; }
        // fund accounting: the fund is the counterparty of the trader's net result (margin in, payout + fee + reward out)
        uint256 outflow = payout + fee + liqReward;
        if (uint256(p.margin) >= outflow) fund += uint256(p.margin) - outflow;
        else { uint256 short_ = outflow - uint256(p.margin); if (fund >= short_) fund -= short_; else { badDebt += short_ - fund; fund = 0; } }
        if (liquidated && payout == 0 && equity < 0) badDebt += uint256(-equity);   // informational: margin did not cover the loss
        // OI
        if (p.isLong) m.longOI -= p.notional; else m.shortOI -= p.notional;
        address owner = p.owner; p.owner = address(0);
        _splitFee(fee);
        if (liqReward > 0) _pay(liquidator, liqReward);
        if (payout > 0) _pay(owner, payout);
        emit Closed(id, owner, px, pnl, fundingPaid, fee, payout, liquidated, liquidator);
    }

    function _splitFee(uint256 fee) internal {
        if (fee == 0) return;
        uint256 toTreasury = fee * FEE_TO_TREASURY_BPS / BPS;
        // fees were already counted into `fund` via margin/outflow accounting on close; on open the fee arrived in msg.value
        fund += fee - toTreasury;
        _pay(treasury, toTreasury);
        emit FeeSplit(fee - toTreasury, toTreasury);
    }

    function _pay(address to, uint256 amount) internal { (bool ok, ) = to.call{value: amount}(""); require(ok, "pay"); }

    // ───────────────────────── LP fund ─────────────────────────
    function lpDeposit() external payable {
        require(msg.value >= U, "min 1 USDC");
        uint256 sh = fundShares == 0 || fund == 0 ? msg.value : msg.value * fundShares / fund;
        fund += msg.value; fundShares += sh; shares[msg.sender] += sh; lpUnlockAt[msg.sender] = uint64(block.timestamp + LP_LOCK);
        emit LpDeposit(msg.sender, msg.value, sh);
    }

    /// @notice Withdraw LP shares; the fund must keep enough to back unmatched OI (otherwise reduce the amount).
    function lpWithdraw(uint256 sh) external {
        require(sh > 0 && sh <= shares[msg.sender], "shares");
        require(block.timestamp >= lpUnlockAt[msg.sender], "locked 24h");
        uint256 amount = sh * fund / fundShares;
        shares[msg.sender] -= sh; fundShares -= sh; fund -= amount;
        require(fund >= _requiredFund(), "backing OI");
        _pay(msg.sender, amount);
        emit LpWithdraw(msg.sender, amount, sh);
    }

    function _requiredFund() internal view returns (uint256 req) {
        for (uint256 i = 0; i < markets.length; i++) {
            Market storage m = markets[i];
            uint256 un = m.longOI > m.shortOI ? m.longOI - m.shortOI : m.shortOI - m.longOI;
            uint256 need = un * BPS / UNMATCHED_CAP_BPS;
            if (need > req) req = need;
        }
    }

    // ───────────────────────── views ─────────────────────────
    function marketCount() external view returns (uint256) { return markets.length; }
    function positionCount() external view returns (uint256) { return positions.length; }
    function userPositions(address u) external view returns (uint256[] memory) { return _userPositions[u]; }
    function equityOf(uint256 id) external view returns (int256 equity, int256 pnl, int256 fundingPaid, uint128 markPrice) {
        Position storage p = positions[id]; markPrice = markets[p.market].price; (equity, pnl, fundingPaid) = _equity(id, markPrice);
    }
    function liquidationPrice(uint256 id) external view returns (uint256) {
        Position storage p = positions[id];
        // equity = margin + notional × (px/entry − 1) [long] ≤ maint → px = entry × (1 − (margin − maint)/notional)
        uint256 buffer = uint256(p.margin) * (BPS - MAINT_MARGIN_BPS) / BPS;
        uint256 move = buffer * PRICE_SCALE / uint256(p.notional);   // fraction of price, 8 dec
        return p.isLong ? uint256(p.entryPrice) * (PRICE_SCALE - move) / PRICE_SCALE : uint256(p.entryPrice) * (PRICE_SCALE + move) / PRICE_SCALE;
    }
    function maxLeverage(uint256 market) external view returns (uint16) { Market storage m = markets[market]; return m.feedLive ? m.maxLevLive : m.maxLevOff; }
    function capacity(uint256 market, bool isLong) external view returns (uint256) {
        Market storage m = markets[market];
        uint256 byCap = isLong ? (m.oiCap > m.longOI ? m.oiCap - m.longOI : 0) : (m.oiCap > m.shortOI ? m.oiCap - m.shortOI : 0);
        uint256 matched = isLong ? (m.shortOI > m.longOI ? m.shortOI - m.longOI : 0) : (m.longOI > m.shortOI ? m.longOI - m.shortOI : 0);
        uint256 byFund = matched + fund * UNMATCHED_CAP_BPS / BPS;
        return byCap < byFund ? byCap : byFund;
    }

    receive() external payable { fund += msg.value; }   // donations / treasury seeding go straight to the fund
}
