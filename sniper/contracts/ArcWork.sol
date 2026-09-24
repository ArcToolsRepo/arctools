// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * ArcWork — the ArcTools services marketplace with USDC escrow on Arc.
 *
 * Sellers list fixed-price gigs (logo, website, TG setup, KOL post, contract review...). A buyer hires with one
 * payment: the USDC sits in this contract until the seller delivers and the buyer accepts. Nobody at ArcTools
 * holds the money; the contract does. What ArcTools does hold is the tie-breaker: an arbiter who can split a
 * disputed order between the two sides, and nothing else.
 *
 * Order life cycle
 *   Paid ──deliver──▶ Delivered ──accept / 72 h silence──▶ Completed (seller gets price − fee, treasury gets fee)
 *   Paid ──refund by seller / cancel by buyer while not delivered after deadline──▶ Refunded (buyer gets 100 %)
 *   Paid | Delivered ──dispute (either side)──▶ Disputed ──arbiter resolve(buyerBps)──▶ Resolved (split; fee only on seller share)
 *
 * Fees: 2 % of the price on completion, taken from the seller's side (the buyer pays the listed price, not more);
 *       1 % when the seller holds ≥ ARCT_TIER ARCT at completion. Fee ≤ 5 % hard cap. Refunds carry no fee.
 * Reviews: one per completed/resolved order, by the buyer, 1–5 stars, on-chain — reputation nobody can edit.
 *
 * Native token: USDC is the gas token on Arc (msg.value, 18 decimals).
 */
interface IERC20Bal { function balanceOf(address) external view returns (uint256); }

contract ArcWork {
    enum Status { None, Paid, Delivered, Completed, Refunded, Disputed, Resolved }

    struct Gig {
        address seller;
        uint8 category;          // index into the off-chain category list (0 logo, 1 website, 2 tg/discord, 3 kol, 4 contract review, 5 other)
        uint96 price;            // wei of USDC, fits 7.9e10 USDC
        uint32 deliveryDays;     // promised delivery time
        bool active;
        string uri;              // off-chain metadata (title, description, samples, contact hint) — ArcTools API or ipfs://
        uint32 sold;             // completed orders
        uint32 disputed;         // orders that went to the arbiter
        uint32 ratingSum;        // sum of stars
        uint32 ratingCount;
    }

    struct Order {
        uint256 gigId;
        address buyer;
        address seller;
        uint96 amount;           // escrowed
        uint64 paidAt;
        uint64 deadline;         // paidAt + deliveryDays
        uint64 deliveredAt;
        Status status;
        uint16 buyerBps;         // resolve() split
        string brief;            // buyer's requirements / contact (short; long text goes to the uri)
        string delivery;         // seller's delivery uri / note
        uint8 stars;             // review, 0 = none
    }

    address public admin;          // config + arbiter appointment
    address public arbiter;        // dispute resolution only
    address public treasury;
    uint16 public feeBps = 200;
    uint16 public tierFeeBps = 100;
    uint256 public constant MAX_FEE_BPS = 500;
    uint64 public acceptWindow = 72 hours;    // buyer silence after delivery → seller can claim
    uint64 public cancelGrace = 3 days;       // after deadline, buyer can cancel an undelivered order
    address public arct;                      // tier token
    uint256 public arctTier = 250_000 ether;  // ≥ this balance → tierFeeBps
    bool public paused;

    Gig[] public gigs;
    Order[] public orders;
    mapping(address => uint256[]) public gigsOf;
    mapping(address => uint256[]) public ordersOfBuyer;
    mapping(address => uint256[]) public ordersOfSeller;

    event GigCreated(uint256 indexed id, address indexed seller, uint8 category, uint96 price, uint32 deliveryDays, string uri);
    event GigUpdated(uint256 indexed id, bool active, uint96 price, uint32 deliveryDays, string uri);
    event OrderPaid(uint256 indexed id, uint256 indexed gigId, address indexed buyer, address seller, uint96 amount, uint64 deadline);
    event OrderDelivered(uint256 indexed id, string delivery);
    event OrderCompleted(uint256 indexed id, uint256 sellerAmount, uint256 fee, bool bySilence);
    event OrderRefunded(uint256 indexed id, address by);
    event OrderDisputed(uint256 indexed id, address by, string reason);
    event OrderResolved(uint256 indexed id, uint16 buyerBps, uint256 buyerAmount, uint256 sellerAmount, uint256 fee, string note);
    event Reviewed(uint256 indexed id, uint256 indexed gigId, uint8 stars, string text);
    event Paused(bool on);

    error NotAdmin(); error NotArbiter(); error NotSeller(); error NotBuyer(); error NotParty(); error BadStatus(); error BadValue();
    error Inactive(); error TooEarly(); error BadConfig(); error Reentered(); error TransferFailed(); error AlreadyReviewed(); error IsPaused();

    uint256 private _lock;
    modifier nonReentrant() { if (_lock == 1) revert Reentered(); _lock = 1; _; _lock = 0; }
    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }

    constructor(address _admin, address _arbiter, address _treasury, address _arct) {
        if (_admin == address(0) || _arbiter == address(0) || _treasury == address(0)) revert BadConfig();
        admin = _admin; arbiter = _arbiter; treasury = _treasury; arct = _arct;
    }

    // ───────────────────────── gigs ─────────────────────────
    function createGig(uint8 category, uint96 price, uint32 deliveryDays, string calldata uri) external returns (uint256 id) {
        if (paused) revert IsPaused();
        if (price < 1 ether || deliveryDays == 0 || deliveryDays > 90 || bytes(uri).length == 0 || bytes(uri).length > 200) revert BadConfig();
        id = gigs.length;
        gigs.push(Gig({ seller: msg.sender, category: category, price: price, deliveryDays: deliveryDays, active: true, uri: uri, sold: 0, disputed: 0, ratingSum: 0, ratingCount: 0 }));
        gigsOf[msg.sender].push(id);
        emit GigCreated(id, msg.sender, category, price, deliveryDays, uri);
    }

    function updateGig(uint256 id, bool active, uint96 price, uint32 deliveryDays, string calldata uri) external {
        Gig storage g = gigs[id];
        if (g.seller != msg.sender) revert NotSeller();
        if (price < 1 ether || deliveryDays == 0 || deliveryDays > 90 || bytes(uri).length == 0 || bytes(uri).length > 200) revert BadConfig();
        g.active = active; g.price = price; g.deliveryDays = deliveryDays; g.uri = uri;
        emit GigUpdated(id, active, price, deliveryDays, uri);
    }

    // ───────────────────────── orders ─────────────────────────
    /** buyer pays the listed price; the brief (what exactly, where to deliver, how to reach you) is stored with the order */
    function hire(uint256 gigId, string calldata brief) external payable nonReentrant returns (uint256 id) {
        if (paused) revert IsPaused();
        Gig storage g = gigs[gigId];
        if (!g.active) revert Inactive();
        if (msg.value != g.price) revert BadValue();
        if (msg.sender == g.seller || bytes(brief).length > 600) revert BadConfig();
        id = orders.length;
        uint64 deadline = uint64(block.timestamp) + uint64(g.deliveryDays) * 1 days;
        orders.push(Order({ gigId: gigId, buyer: msg.sender, seller: g.seller, amount: uint96(msg.value), paidAt: uint64(block.timestamp), deadline: deadline, deliveredAt: 0,
                            status: Status.Paid, buyerBps: 0, brief: brief, delivery: "", stars: 0 }));
        ordersOfBuyer[msg.sender].push(id); ordersOfSeller[g.seller].push(id);
        emit OrderPaid(id, gigId, msg.sender, g.seller, uint96(msg.value), deadline);
    }

    function deliver(uint256 id, string calldata delivery) external {
        Order storage o = orders[id];
        if (o.seller != msg.sender) revert NotSeller();
        if (o.status != Status.Paid && o.status != Status.Delivered) revert BadStatus();   // re-deliver allowed (revision)
        if (bytes(delivery).length > 600) revert BadConfig();
        o.delivery = delivery; o.deliveredAt = uint64(block.timestamp); o.status = Status.Delivered;
        emit OrderDelivered(id, delivery);
    }

    /** buyer is happy → seller paid, fee to treasury */
    function accept(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.buyer != msg.sender) revert NotBuyer();
        if (o.status != Status.Delivered) revert BadStatus();
        _complete(id, o, false);
    }

    /** buyer silent for acceptWindow after delivery → seller claims (protects sellers from ghosting buyers) */
    function claimAfterSilence(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.seller != msg.sender) revert NotSeller();
        if (o.status != Status.Delivered) revert BadStatus();
        if (block.timestamp < o.deliveredAt + acceptWindow) revert TooEarly();
        _complete(id, o, true);
    }

    /** seller gives the money back at any time before completion (cannot deliver, changed mind) */
    function refund(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.seller != msg.sender) revert NotSeller();
        if (o.status != Status.Paid && o.status != Status.Delivered) revert BadStatus();
        o.status = Status.Refunded;
        _send(o.buyer, o.amount);
        emit OrderRefunded(id, msg.sender);
    }

    /** buyer takes the money back if nothing was delivered by deadline + grace (protects buyers from ghosting sellers) */
    function cancelUndelivered(uint256 id) external nonReentrant {
        Order storage o = orders[id];
        if (o.buyer != msg.sender) revert NotBuyer();
        if (o.status != Status.Paid) revert BadStatus();
        if (block.timestamp < o.deadline + cancelGrace) revert TooEarly();
        o.status = Status.Refunded;
        _send(o.buyer, o.amount);
        emit OrderRefunded(id, msg.sender);
    }

    /** either side escalates; funds freeze until the arbiter splits them */
    function dispute(uint256 id, string calldata reason) external {
        Order storage o = orders[id];
        if (msg.sender != o.buyer && msg.sender != o.seller) revert NotParty();
        if (o.status != Status.Paid && o.status != Status.Delivered) revert BadStatus();
        if (bytes(reason).length > 400) revert BadConfig();
        o.status = Status.Disputed;
        gigs[o.gigId].disputed += 1;
        emit OrderDisputed(id, msg.sender, reason);
    }

    /** the only power ArcTools has over an order: split a disputed one. buyerBps 10000 = full refund, 0 = seller keeps all. Fee only on the seller's share. */
    function resolve(uint256 id, uint16 buyerBps, string calldata note) external nonReentrant {
        if (msg.sender != arbiter) revert NotArbiter();
        Order storage o = orders[id];
        if (o.status != Status.Disputed) revert BadStatus();
        if (buyerBps > 10_000 || bytes(note).length > 400) revert BadConfig();
        o.status = Status.Resolved; o.buyerBps = buyerBps;
        uint256 toBuyer = (uint256(o.amount) * buyerBps) / 10_000;
        uint256 sellerGross = o.amount - toBuyer;
        uint256 fee = (sellerGross * _feeFor(o.seller)) / 10_000;
        if (toBuyer > 0) _send(o.buyer, toBuyer);
        if (sellerGross - fee > 0) _send(o.seller, sellerGross - fee);
        if (fee > 0) _send(treasury, fee);
        emit OrderResolved(id, buyerBps, toBuyer, sellerGross - fee, fee, note);
    }

    /** one review per finished order, by the buyer; stars land on the gig forever */
    function review(uint256 id, uint8 stars, string calldata text) external {
        Order storage o = orders[id];
        if (o.buyer != msg.sender) revert NotBuyer();
        if (o.status != Status.Completed && o.status != Status.Resolved) revert BadStatus();
        if (o.stars != 0) revert AlreadyReviewed();
        if (stars < 1 || stars > 5 || bytes(text).length > 400) revert BadConfig();
        o.stars = stars;
        Gig storage g = gigs[o.gigId]; g.ratingSum += stars; g.ratingCount += 1;
        emit Reviewed(id, o.gigId, stars, text);
    }

    function _complete(uint256 id, Order storage o, bool bySilence) internal {
        o.status = Status.Completed;
        uint256 fee = (uint256(o.amount) * _feeFor(o.seller)) / 10_000;
        gigs[o.gigId].sold += 1;
        _send(o.seller, o.amount - fee);
        if (fee > 0) _send(treasury, fee);
        emit OrderCompleted(id, o.amount - fee, fee, bySilence);
    }

    function _feeFor(address seller) internal view returns (uint16) {
        if (arct != address(0)) {
            (bool ok, bytes memory r) = arct.staticcall(abi.encodeWithSelector(IERC20Bal.balanceOf.selector, seller));
            if (ok && r.length >= 32 && abi.decode(r, (uint256)) >= arctTier) return tierFeeBps;
        }
        return feeBps;
    }
    function feeFor(address seller) external view returns (uint16) { return _feeFor(seller); }

    function _send(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ───────────────────────── admin ─────────────────────────
    function setFees(uint16 _feeBps, uint16 _tierFeeBps, uint256 _arctTier) external onlyAdmin {
        if (_feeBps > MAX_FEE_BPS || _tierFeeBps > _feeBps) revert BadConfig();
        feeBps = _feeBps; tierFeeBps = _tierFeeBps; arctTier = _arctTier;
    }
    function setWindows(uint64 _acceptWindow, uint64 _cancelGrace) external onlyAdmin {
        if (_acceptWindow < 24 hours || _acceptWindow > 14 days || _cancelGrace > 30 days) revert BadConfig();
        acceptWindow = _acceptWindow; cancelGrace = _cancelGrace;
    }
    function setRoles(address _admin, address _arbiter, address _treasury) external onlyAdmin {
        if (_admin == address(0) || _arbiter == address(0) || _treasury == address(0)) revert BadConfig();
        admin = _admin; arbiter = _arbiter; treasury = _treasury;
    }
    /** pause stops new gigs and new orders only — deliveries, accepts, refunds, disputes and resolutions always work */
    function setPaused(bool on) external onlyAdmin { paused = on; emit Paused(on); }
    // no admin withdrawal: every wei belongs to an order and leaves via accept / claim / refund / cancel / resolve.

    // ───────────────────────── views ─────────────────────────
    function gigsCount() external view returns (uint256) { return gigs.length; }
    function ordersCount() external view returns (uint256) { return orders.length; }
    function getGigs(uint256 from, uint256 n) external view returns (Gig[] memory out) {
        if (from >= gigs.length) return out;
        if (from + n > gigs.length) n = gigs.length - from;
        out = new Gig[](n); for (uint256 i = 0; i < n; i++) out[i] = gigs[from + i];
    }
    function getOrders(uint256[] calldata ids) external view returns (Order[] memory out) {
        out = new Order[](ids.length); for (uint256 i = 0; i < ids.length; i++) out[i] = orders[ids[i]];
    }
    function gigsOfLength(address s) external view returns (uint256) { return gigsOf[s].length; }
    function ordersOfBuyerLength(address b) external view returns (uint256) { return ordersOfBuyer[b].length; }
    function ordersOfSellerLength(address s) external view returns (uint256) { return ordersOfSeller[s].length; }
    function getOrdersOfBuyer(address b) external view returns (uint256[] memory) { return ordersOfBuyer[b]; }
    function getOrdersOfSeller(address s) external view returns (uint256[] memory) { return ordersOfSeller[s]; }
    receive() external payable { revert(); }
}
