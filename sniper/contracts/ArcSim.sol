// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ArcSim — honeypot / tradability probe for ArcTools.
/// @notice NEVER deployed. Its runtime code is injected into a throwaway address with an `eth_call` state
///         override, so a full buy -> sell round trip runs against real mainnet state for free and without
///         touching a single wallet. What we learn from one call:
///           * does a buy actually execute (or does the token revert on receive / have no route),
///           * does the buyer get any tokens at all (a transfer that silently sends 0 is the classic trap),
///           * can the same buyer sell them back in the next instruction — the definition of a honeypot,
///           * what fraction of the money survives the round trip (sell tax + pool fees + impact).
///         Stages are reported instead of reverting, so the caller can tell "no route" from "cannot sell".
contract ArcSim {
    struct Key { address currency0; address currency1; uint24 fee; int24 tickSpacing; address hooks; }
    struct Leg { uint8 venue; address target; uint24 fee; Key key; uint256 amount; }

    /// stage: 0 = buy call reverted, 1 = buy returned no tokens, 2 = sell call reverted (HONEYPOT),
    ///        3 = sell returned no USDC, 4 = full round trip completed
    function probe(address agg, address token, Leg[] calldata buyLegs, Leg[] calldata sellLegs, uint256 spend)
        external
        payable
        returns (uint8 stage, uint256 bought, uint256 returned, uint256 sellable)
    {
        (bool ok, ) = agg.call{value: spend}(
            abi.encodeWithSignature(
                "buy(address,(uint8,address,uint24,(address,address,uint24,int24,address),uint256)[],uint256,address,uint16)",
                token, buyLegs, uint256(0), address(this), uint16(0)
            )
        );
        if (!ok) return (0, 0, 0, 0);

        bought = _balance(token, address(this));
        if (bought == 0) return (1, 0, 0, 0);

        // a token can also lie in the other direction: report a balance it will not let you move

        Leg[] memory legs = new Leg[](sellLegs.length);
        uint256 total;
        for (uint256 i; i < sellLegs.length; i++) total += sellLegs[i].amount;
        // The router may deliberately plan to sell LESS than the whole position: an ArcPad v3.1 curve reverts a
        // sell whose payout exceeds its real USDC reserve, so the router caps the amount to what the curve can pay.
        // Scaling that plan back up to `bought` re-created the revert and flagged our own launchpad's tokens as
        // honeypots. Sell what the router planned (capped at the balance); the remainder counts as unsold.
        uint256 target = total < bought ? total : bought;
        uint256 assigned;
        for (uint256 i; i < sellLegs.length; i++) {
            legs[i] = sellLegs[i];
            // keep the planned split ratio, give the remainder to the last leg so nothing is left behind
            legs[i].amount = i == sellLegs.length - 1 ? target - assigned : (target * sellLegs[i].amount) / total;
            assigned += legs[i].amount;
        }
        sellable = target;

        (bool okA, ) = token.call(abi.encodeWithSignature("approve(address,uint256)", agg, type(uint256).max));
        okA;                                   // a token that refuses to approve fails the sell below anyway

        uint256 before = address(this).balance;
        (bool okS, ) = agg.call(
            abi.encodeWithSignature(
                "sell(address,(uint8,address,uint24,(address,address,uint24,int24,address),uint256)[],uint256,address,uint16)",
                token, legs, uint256(0), address(this), uint16(0)
            )
        );
        if (!okS) return (2, bought, 0, sellable);

        returned = address(this).balance - before;
        if (returned == 0) return (3, bought, 0, sellable);
        return (4, bought, returned, sellable);
    }

    function _balance(address token, address who) internal view returns (uint256) {
        (bool ok, bytes memory out) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", who));
        return ok && out.length >= 32 ? abi.decode(out, (uint256)) : 0;
    }

    receive() external payable {}
}
