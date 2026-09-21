// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title FreelanceMilestoneEscrow
/// @notice Minimal single-milestone escrow between a client and a freelancer.
/// @dev Checks-Effects-Interactions throughout; custom errors instead of require strings;
///      raw `call{value: ...}("")` used for all ETH transfers (no `.transfer()`).
contract FreelanceMilestoneEscrow {
    /// @notice Lifecycle states of the escrow.
    enum EscrowState {
        AWAITING_PAYMENT,
        FUNDED,
        COMPLETED,
        REFUNDED
    }

    /// @notice The party who deploys the contract and funds the milestone.
    address public immutable client;

    /// @notice The party who is paid upon successful completion of the milestone.
    address public immutable freelancer;

    /// @notice Current lifecycle state of the escrow.
    EscrowState public state;

    // --- Events ---
    event FundsDeposited(address indexed client, uint256 amount);
    event PaymentReleased(address indexed freelancer, uint256 amount);
    event ClientRefunded(address indexed client, uint256 amount);

    // --- Custom Errors (gas-efficient alternative to require strings) ---
    error Unauthorized();
    error InvalidState();
    error ZeroAddress();
    error ZeroDeposit();
    error TransferFailed();

    /// @param _freelancer Address of the freelancer who will be paid on completion.
    constructor(address _freelancer) {
        if (_freelancer == address(0)) revert ZeroAddress();
        client = msg.sender;
        freelancer = _freelancer;
        state = EscrowState.AWAITING_PAYMENT;
    }

    modifier onlyClient() {
        if (msg.sender != client) revert Unauthorized();
        _;
    }

    modifier onlyFreelancer() {
        if (msg.sender != freelancer) revert Unauthorized();
        _;
    }

    modifier inState(EscrowState _expected) {
        if (state != _expected) revert InvalidState();
        _;
    }

    /// @notice Client funds the milestone. Moves AWAITING_PAYMENT -> FUNDED.
    function depositFunds() external payable onlyClient inState(EscrowState.AWAITING_PAYMENT) {
        if (msg.value == 0) revert ZeroDeposit();

        // Effects
        state = EscrowState.FUNDED;

        emit FundsDeposited(msg.sender, msg.value);
    }

    /// @notice Client approves completed work and releases funds to the freelancer.
    ///         Moves FUNDED -> COMPLETED.
    function releasePayment() external onlyClient inState(EscrowState.FUNDED) {
        uint256 amount = address(this).balance;

        // Effects (state finalized before external interaction)
        state = EscrowState.COMPLETED;

        // Interaction
        (bool success, ) = payable(freelancer).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit PaymentReleased(freelancer, amount);
    }

    /// @notice Freelancer voluntarily returns funds to the client (escape hatch).
    ///         Moves FUNDED -> REFUNDED.
    function refundClient() external onlyFreelancer inState(EscrowState.FUNDED) {
        uint256 amount = address(this).balance;

        // Effects (state finalized before external interaction)
        state = EscrowState.REFUNDED;

        // Interaction
        (bool success, ) = payable(client).call{value: amount}("");
        if (!success) revert TransferFailed();

        emit ClientRefunded(client, amount);
    }

    /// @notice Convenience view of the contract's current ETH balance.
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }
}
