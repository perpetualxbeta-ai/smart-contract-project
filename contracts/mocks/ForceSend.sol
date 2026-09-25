// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @dev TEST ONLY. Pushes ETH to a target without calling its code (bypasses receive/fallback).
contract ForceSend {
    constructor() payable {}

    function attack(address payable target) external {
        selfdestruct(target);
    }
}
