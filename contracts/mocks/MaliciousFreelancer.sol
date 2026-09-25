// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IEscrow {
    function refundClient() external;
    function releasePayment() external;
}

/// @dev TEST ONLY. Freelancer contract. Modes: 0 = accept ETH, 1 = revert on receive,
///      2 = try to re-enter refundClient()/releasePayment() while receiving payment.
contract MaliciousFreelancer {
    IEscrow public escrow;
    uint8 public mode;
    bool public reentryAttempted;
    bool public refundReentrySucceeded;
    bool public releaseReentrySucceeded;
    bytes4 public refundErrorSelector;

    function setEscrow(address e) external {
        escrow = IEscrow(e);
    }

    function setMode(uint8 m) external {
        mode = m;
    }

    function callRefund() external {
        escrow.refundClient();
    }

    receive() external payable {
        if (mode == 1) revert("freelancer rejects ETH");
        if (mode == 2) {
            reentryAttempted = true;
            try escrow.refundClient() {
                refundReentrySucceeded = true;
            } catch (bytes memory data) {
                if (data.length >= 4) refundErrorSelector = bytes4(data);
            }
            try escrow.releasePayment() {
                releaseReentrySucceeded = true;
            } catch {}
        }
    }
}
