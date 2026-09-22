// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * ArcPredict — UP / DOWN price prediction rounds on Arc, paid in native USDC.
 *
 * One instance per market (BTC/USD, ETH/USD, SOL/USD, ...). Parimutuel: everyone who picked the winning side
 * shares the whole pool of the round pro rata, minus the treasury fee. Rolling rounds like PancakeSwap Prediction:
 * while round N is "live" (locked, waiting for its close price), round N+1 accepts bets; one operator call
 * (`executeRound`) closes N, locks N+1 and opens N+2.
 *
 * Prices are posted by the operator (the ArcTools bot, reading a global mark price the Arc chain cannot move).
 * The contract cannot verify a price — it CAN guarantee the things that protect bettors from the operator:
 *   - a price is posted once and never changed; lock and close prices are events anyone can compare with the source;
 *   - if the operator is late (> bufferSeconds after lockTime / closeTime) the round can no longer be resolved and
 *     every bettor takes their full stake back (`claim` pays refunds for unresolved rounds; anyone can `cancelRound`);
 *   - a tie (close == lock) refunds everyone — the house never wins a tie;
 *   - `pause` stops new bets but never blocks claims and refunds; fee is capped at 10 %;
 *   - the treasury only ever receives the fee of a resolved round, nothing from refunds.
 *
 * Native token: USDC is the gas token on Arc (18 decimals in msg.value), so bets are plain payable calls.
 */
contract ArcPredict {
    // ───────────────────────────── types ─────────────────────────────
    enum Position { None, Up, Down }
    enum Status { Open, Locked, Resolved, Cancelled }

    struct Round {
        uint256 epoch;
        uint64 startTime;      // bets open (previous round locks)
        uint64 lockTime;       // bets close, lock price posted
        uint64 closeTime;      // close price posted, winners known
        int256 lockPrice;      // 8 decimals, as posted
        int256 closePrice;
        uint256 upAmount;
        uint256 downAmount;
        uint256 rewardBase;    // amount of the winning side (0 on refund rounds)
        uint256 rewardAmount;  // pool minus fee (0 on refund rounds)
        uint256 fee;           // treasury fee taken
        Status status;
        Position winner;       // Position.None on tie / cancel
    }

    struct Bet {
        Position position;
        uint256 amount;
        bool claimed;
    }

    // ───────────────────────────── config ─────────────────────────────
    string public market;                 // "BTC/USD"
    address public admin;                 // owner: config + pause
    address public operator;              // bot: posts prices
    address public treasury;              // fee receiver
    uint256 public intervalSeconds;       // round length (lock → close), also start → lock
    uint256 public bufferSeconds;         // grace for the operator after lockTime / closeTime
    uint256 public minBet;                // in wei of USDC (18 dec)
    uint256 public maxBet;                // per address per round, 0 = unlimited
    uint256 public treasuryFeeBps;        // ≤ 1000
    uint256 public constant MAX_FEE_BPS = 1000;

    bool public paused;
    bool public genesisStarted;
    bool public genesisLocked;
    uint256 public currentEpoch;          // the round currently accepting bets

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => Bet)) public bets;
    mapping(address => uint256[]) public userRounds;   // for claim discovery in the UI

    // ───────────────────────────── events ─────────────────────────────
    event StartRound(uint256 indexed epoch, uint64 startTime, uint64 lockTime, uint64 closeTime);
    event LockRound(uint256 indexed epoch, int256 price, uint64 at);
    event EndRound(uint256 indexed epoch, int256 price, uint64 at, Position winner, uint256 rewardAmount, uint256 fee);
    event CancelRound(uint256 indexed epoch, string reason);
    event BetPlaced(address indexed user, uint256 indexed epoch, Position position, uint256 amount);
    event Claimed(address indexed user, uint256 indexed epoch, uint256 amount, bool refund);
    event Paused(bool on);
    event ConfigChanged(uint256 intervalSeconds, uint256 bufferSeconds, uint256 minBet, uint256 maxBet, uint256 treasuryFeeBps);
    event RolesChanged(address admin, address operator, address treasury);

    // ───────────────────────────── errors ─────────────────────────────
    error NotAdmin();
    error NotOperator();
    error IsPaused();
    error BadEpoch();
    error BettingClosed();
    error TooSmall();
    error TooLarge();
    error AlreadyBet();
    error NotBettable();
    error TooEarly();
    error TooLate();
    error NothingToClaim();
    error Genesis();
    error BadConfig();
    error TransferFailed();
    error Reentered();

    uint256 private _lock;
    modifier nonReentrant() { if (_lock == 1) revert Reentered(); _lock = 1; _; _lock = 0; }
    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }
    modifier onlyOperator() { if (msg.sender != operator && msg.sender != admin) revert NotOperator(); _; }
    modifier whenNotPaused() { if (paused) revert IsPaused(); _; }

    constructor(string memory _market, address _admin, address _operator, address _treasury,
                uint256 _intervalSeconds, uint256 _bufferSeconds, uint256 _minBet, uint256 _maxBet, uint256 _treasuryFeeBps) {
        if (_admin == address(0) || _operator == address(0) || _treasury == address(0)) revert BadConfig();
        if (_treasuryFeeBps > MAX_FEE_BPS || _intervalSeconds < 30 || _bufferSeconds == 0 || _bufferSeconds > _intervalSeconds) revert BadConfig();
        market = _market; admin = _admin; operator = _operator; treasury = _treasury;
        intervalSeconds = _intervalSeconds; bufferSeconds = _bufferSeconds; minBet = _minBet; maxBet = _maxBet; treasuryFeeBps = _treasuryFeeBps;
    }

    // ───────────────────────────── betting ─────────────────────────────
    function betUp(uint256 epoch) external payable whenNotPaused nonReentrant { _bet(epoch, Position.Up); }
    function betDown(uint256 epoch) external payable whenNotPaused nonReentrant { _bet(epoch, Position.Down); }

    function _bet(uint256 epoch, Position pos) internal {
        if (epoch != currentEpoch) revert BadEpoch();
        Round storage r = rounds[epoch];
        if (r.status != Status.Open || block.timestamp >= r.lockTime) revert BettingClosed();
        if (msg.value < minBet) revert TooSmall();
        Bet storage b = bets[epoch][msg.sender];
        if (b.amount != 0) revert AlreadyBet();                // one position per round per wallet
        if (maxBet != 0 && msg.value > maxBet) revert TooLarge();
        b.position = pos; b.amount = msg.value;
        if (pos == Position.Up) r.upAmount += msg.value; else r.downAmount += msg.value;
        userRounds[msg.sender].push(epoch);
        emit BetPlaced(msg.sender, epoch, pos, msg.value);
    }

    /** claim winnings or refunds for many rounds at once. Refund = the round was cancelled, tied, or one side was empty. */
    function claim(uint256[] calldata epochs) external nonReentrant {
        uint256 total;
        for (uint256 i = 0; i < epochs.length; i++) {
            uint256 e = epochs[i];
            Round storage r = rounds[e];
            Bet storage b = bets[e][msg.sender];
            if (b.amount == 0 || b.claimed) continue;
            // a locked round whose close is overdue is refundable even before anyone calls cancelRound
            if (r.status == Status.Locked && block.timestamp > r.closeTime + bufferSeconds) _cancel(e, "close overdue");
            if (r.status == Status.Open && block.timestamp > r.lockTime + bufferSeconds) _cancel(e, "lock overdue");
            uint256 pay;
            bool refund;
            if (r.status == Status.Resolved) {
                if (r.winner == Position.None) { pay = b.amount; refund = true; }              // tie → refund
                else if (b.position == r.winner) { pay = (b.amount * r.rewardAmount) / r.rewardBase; }
                else continue;                                                                   // lost: nothing, leave unclaimed=false? mark claimed to keep UI clean
            } else if (r.status == Status.Cancelled) { pay = b.amount; refund = true; }
            else continue;                                                                       // still open / locked
            b.claimed = true;
            total += pay;
            emit Claimed(msg.sender, e, pay, refund);
        }
        if (total == 0) revert NothingToClaim();
        _send(msg.sender, total);
    }

    /** what `claim` would pay right now for these rounds (0 for lost / pending) */
    function claimable(address user, uint256[] calldata epochs) external view returns (uint256[] memory out) {
        out = new uint256[](epochs.length);
        for (uint256 i = 0; i < epochs.length; i++) {
            Round storage r = rounds[epochs[i]]; Bet storage b = bets[epochs[i]][user];
            if (b.amount == 0 || b.claimed) continue;
            bool overdue = (r.status == Status.Locked && block.timestamp > r.closeTime + bufferSeconds) || (r.status == Status.Open && block.timestamp > r.lockTime + bufferSeconds);
            if (r.status == Status.Cancelled || overdue) out[i] = b.amount;
            else if (r.status == Status.Resolved) {
                if (r.winner == Position.None) out[i] = b.amount;
                else if (b.position == r.winner) out[i] = (b.amount * r.rewardAmount) / r.rewardBase;
            }
        }
    }

    // ───────────────────────────── operator ─────────────────────────────
    /** first call: opens round 1 (bets), nothing to lock yet */
    function genesisStart() external onlyOperator whenNotPaused {
        if (genesisStarted) revert Genesis();
        genesisStarted = true;
        currentEpoch = 1;
        _start(1);
    }

    /** second call, after round 1's lockTime: lock round 1 with a price, open round 2 */
    function genesisLock(int256 price) external onlyOperator whenNotPaused {
        if (!genesisStarted || genesisLocked) revert Genesis();
        _lockRound(currentEpoch, price);
        genesisLocked = true;
        currentEpoch += 1;
        _start(currentEpoch);
    }

    /** every interval: close round N-1 (needs its price), lock round N (same price, it is the lock price of N), open N+1 */
    function executeRound(int256 price) external onlyOperator whenNotPaused {
        if (!genesisStarted || !genesisLocked) revert Genesis();
        _endRound(currentEpoch - 1, price);
        _lockRound(currentEpoch, price);
        currentEpoch += 1;
        _start(currentEpoch);
    }

    /** anyone: a round the operator failed to lock/close in time becomes refundable */
    function cancelRound(uint256 epoch) external {
        Round storage r = rounds[epoch];
        if (r.status == Status.Locked && block.timestamp > r.closeTime + bufferSeconds) { _cancel(epoch, "close overdue"); return; }
        if (r.status == Status.Open && block.timestamp > r.lockTime + bufferSeconds) { _cancel(epoch, "lock overdue"); return; }
        revert TooEarly();
    }

    /** after a stall (operator dead > buffer): admin restarts the rolling schedule. The two live rounds are cancelled (full refunds), betting reopens. */
    function restart() external onlyAdmin {
        if (!genesisStarted) revert Genesis();
        if (currentEpoch >= 2) { Round storage prev = rounds[currentEpoch - 1]; if (prev.status == Status.Open || prev.status == Status.Locked) _cancel(currentEpoch - 1, "restart"); }
        Round storage cur = rounds[currentEpoch]; if (cur.status == Status.Open || cur.status == Status.Locked) _cancel(currentEpoch, "restart");
        genesisLocked = false;
        currentEpoch += 1;
        _start(currentEpoch);
    }

    function _start(uint256 epoch) internal {
        Round storage r = rounds[epoch];
        r.epoch = epoch;
        r.startTime = uint64(block.timestamp);
        r.lockTime = uint64(block.timestamp + intervalSeconds);
        r.closeTime = uint64(block.timestamp + 2 * intervalSeconds);
        r.status = Status.Open;
        emit StartRound(epoch, r.startTime, r.lockTime, r.closeTime);
    }

    function _lockRound(uint256 epoch, int256 price) internal {
        Round storage r = rounds[epoch];
        if (r.status != Status.Open) revert NotBettable();
        if (block.timestamp < r.lockTime) revert TooEarly();
        if (block.timestamp > r.lockTime + bufferSeconds) { _cancel(epoch, "lock overdue"); return; }
        r.lockPrice = price;
        r.closeTime = uint64(block.timestamp + intervalSeconds);   // close is measured from the real lock moment
        r.status = Status.Locked;
        emit LockRound(epoch, price, uint64(block.timestamp));
    }

    function _endRound(uint256 epoch, int256 price) internal {
        Round storage r = rounds[epoch];
        if (r.status == Status.Cancelled) return;                // lock was late: already refunded, move on
        if (r.status != Status.Locked) revert NotBettable();
        if (block.timestamp < r.closeTime) revert TooEarly();
        if (block.timestamp > r.closeTime + bufferSeconds) { _cancel(epoch, "close overdue"); return; }
        r.closePrice = price;
        r.status = Status.Resolved;
        uint256 pool = r.upAmount + r.downAmount;
        if (price > r.lockPrice && r.upAmount > 0) r.winner = Position.Up;
        else if (price < r.lockPrice && r.downAmount > 0) r.winner = Position.Down;
        // tie, or the winning side is empty → everybody is refunded, no fee
        if (r.winner == Position.None) { emit EndRound(epoch, price, uint64(block.timestamp), Position.None, 0, 0); return; }
        // if the losing side is empty there is nothing to win: refund too (rewardAmount == rewardBase, fee 0)
        uint256 losing = r.winner == Position.Up ? r.downAmount : r.upAmount;
        r.rewardBase = r.winner == Position.Up ? r.upAmount : r.downAmount;
        if (losing == 0) { r.rewardAmount = r.rewardBase; emit EndRound(epoch, price, uint64(block.timestamp), r.winner, r.rewardAmount, 0); return; }
        r.fee = (pool * treasuryFeeBps) / 10_000;
        r.rewardAmount = pool - r.fee;
        emit EndRound(epoch, price, uint64(block.timestamp), r.winner, r.rewardAmount, r.fee);
        if (r.fee > 0) _send(treasury, r.fee);
    }

    function _cancel(uint256 epoch, string memory reason) internal {
        Round storage r = rounds[epoch];
        r.status = Status.Cancelled;
        emit CancelRound(epoch, reason);
    }

    function _send(address to, uint256 amount) internal {
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ───────────────────────────── admin ─────────────────────────────
    function setPaused(bool on) external onlyAdmin { paused = on; emit Paused(on); }
    function setConfig(uint256 _intervalSeconds, uint256 _bufferSeconds, uint256 _minBet, uint256 _maxBet, uint256 _treasuryFeeBps) external onlyAdmin {
        if (_treasuryFeeBps > MAX_FEE_BPS || _intervalSeconds < 30 || _bufferSeconds == 0 || _bufferSeconds > _intervalSeconds) revert BadConfig();
        intervalSeconds = _intervalSeconds; bufferSeconds = _bufferSeconds; minBet = _minBet; maxBet = _maxBet; treasuryFeeBps = _treasuryFeeBps;
        emit ConfigChanged(_intervalSeconds, _bufferSeconds, _minBet, _maxBet, _treasuryFeeBps);
    }
    function setRoles(address _admin, address _operator, address _treasury) external onlyAdmin {
        if (_admin == address(0) || _operator == address(0) || _treasury == address(0)) revert BadConfig();
        admin = _admin; operator = _operator; treasury = _treasury;
        emit RolesChanged(_admin, _operator, _treasury);
    }
    // NOTE: there is deliberately no admin withdrawal. Every wei in this contract belongs to a bet and leaves only via claim() or as the fee of a resolved round.

    // ───────────────────────────── views ─────────────────────────────
    function getRounds(uint256 from, uint256 n) external view returns (Round[] memory out) {
        out = new Round[](n);
        for (uint256 i = 0; i < n; i++) out[i] = rounds[from + i];
    }
    function userRoundsLength(address user) external view returns (uint256) { return userRounds[user].length; }
    function getUserRounds(address user, uint256 cursor, uint256 n) external view returns (uint256[] memory epochs, Bet[] memory out) {
        uint256 len = userRounds[user].length;
        if (cursor > len) cursor = len;
        uint256 m = n; if (cursor + m > len) m = len - cursor;
        epochs = new uint256[](m); out = new Bet[](m);
        for (uint256 i = 0; i < m; i++) { epochs[i] = userRounds[user][cursor + i]; out[i] = bets[epochs[i]][user]; }
    }
    receive() external payable { revert(); }
}
