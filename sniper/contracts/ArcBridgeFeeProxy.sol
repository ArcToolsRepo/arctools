// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IMessageTransmitterV2 {
    function receiveMessage(bytes calldata message, bytes calldata attestation) external returns (bool);
}

/// @title ArcBridgeFeeProxy
/// @notice Atomic CCTP v2 receive + service fee on Arc. The burn on the source
/// chain sets mintRecipient = THIS contract; bridgeReceive mints the native
/// USDC here, takes feeBps for the fee wallet and forwards the rest to the
/// ORIGINAL source-chain sender (read from the CCTP message itself, so the
/// payout address cannot be spoofed by the caller).
contract ArcBridgeFeeProxy {
    IMessageTransmitterV2 public constant TRANSMITTER =
        IMessageTransmitterV2(0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275);

    address public immutable owner;
    address public immutable feeWallet;
    uint256 public immutable feeBps;

    // CCTP v2 layout: header 148 bytes
    // (version4 srcDomain4 dstDomain4 nonce32 sender32 recipient32 destCaller32 minFin4 finExec4)
    // BurnMessage body: version4 burnToken32 mintRecipient32 amount32 messageSender32 ...
    uint256 private constant SENDER_OFFSET = 148 + 4 + 32 + 32 + 32; // 248

    event Bridged(address indexed user, uint256 minted, uint256 fee);

    constructor(address _feeWallet, uint256 _feeBps) {
        require(_feeWallet != address(0) && _feeBps <= 1000, "bad params");
        owner = msg.sender;
        feeWallet = _feeWallet;
        feeBps = _feeBps;
    }

    receive() external payable {}

    function bridgeReceive(bytes calldata message, bytes calldata attestation) external {
        require(message.length >= SENDER_OFFSET + 32, "short message");
        uint256 balBefore = address(this).balance;
        require(TRANSMITTER.receiveMessage(message, attestation), "receive failed");
        uint256 minted = address(this).balance - balBefore;
        require(minted > 0, "nothing minted");

        address user = address(uint160(uint256(bytes32(message[SENDER_OFFSET:SENDER_OFFSET + 32]))));
        require(user != address(0), "zero user");

        uint256 fee = (minted * feeBps) / 10_000;
        (bool fOk, ) = feeWallet.call{value: fee}("");
        require(fOk, "fee transfer failed");
        (bool uOk, ) = user.call{value: minted - fee}("");
        require(uOk, "user transfer failed");
        emit Bridged(user, minted, fee);
    }

    /// @notice Safety valve: recover funds stuck by an unexpected message format.
    function rescue(address to, uint256 amount) external {
        require(msg.sender == owner, "not owner");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "rescue failed");
    }
}
