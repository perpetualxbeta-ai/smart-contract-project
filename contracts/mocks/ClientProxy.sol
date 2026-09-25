// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FreelanceMilestoneEscrow} from "../FreelanceMilestoneEscrow.sol";

/// @dev TEST ONLY. A contract that deploys and acts as the escrow's client, so tests can
///      exercise the refund path when the *client* cannot (or maliciously will not) receive ETH.
///      Modes: 0 = accept ETH, 1 = revert on receive, 2 = re-enter releasePayment() on receive.
contract ClientProxy {
    FreelanceMilestoneEscrow public immutable escrow;
    uint8 public mode;
    bool public reentryAttempted;
    bool public reentrySucceeded;
    bytes4 public reentryErrorSelector;

    constructor(address freelancer) {
        escrow = new FreelanceMilestoneEscrow(freelancer);
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function deposit() external payable {
        escrow.depositFunds{value: msg.value}();
    }

    function release() external {
        escrow.releasePayment();
    }

    receive() external payable {
        if (mode == 1) revert("client rejects ETH");
        if (mode == 2) {
            reentryAttempted = true;
            try escrow.releasePayment() {
                reentrySucceeded = true;
            } catch (bytes memory data) {
                if (data.length >= 4) reentryErrorSelector = bytes4(data);
            }
        }
    }
}
