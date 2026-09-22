**Overview**

This repo is a proof-of-concept single-milestone escrow: one Solidity contract, contracts/FreelanceMilestoneEscrow.sol (pragma ^0.8.20), plus a Vite/React frontend that connects to an injected EIP-1193 wallet (Rabby Wallet, or any other). A client deploys the contract naming a freelancer address, funds it, then either releases payment to the freelancer or the freelancer voluntarily refunds the client. All state transitions and transfers are enforced on-chain via a 4-state enum (AWAITING_PAYMENT → FUNDED → COMPLETED / REFUNDED); the frontend only reflects contract state, it doesn't gate anything itself.
There is currently no test suite and no test framework configured — no Hardhat, Foundry, or Truffle. scripts/compile.js calls solc directly and scripts/deploy.js deploys with ethers v6 against any JSON-RPC endpoint. This plan is written to be built from scratch.

**Scope**

In scope: contracts/FreelanceMilestoneEscrow.sol (constructor + all 5 functions), and frontend/src/hooks/useEscrowContract.js — the only frontend code that talks to the contract (App.jsx and the presentational components are UI-only and are exercised indirectly through the hook).
Out of scope: wallet UX polish, gas-optimization tuning, upgradability (the contract isn't upgradeable), and multi-milestone support (this is explicitly single-milestone by design, not a gap).

Objective: prove the state machine can't be driven into an inconsistent state, funds always land with the correct party, both roles are strictly gated, and the escape-hatch refund actually works under adversarial conditions.

Test environment setup
npm test doesn't exist yet — there's no framework wired up. Recommended setup:
1. Add Hardhat (fits cleanly with the existing solc 0.8.20 / ethers v6 toolchain already used by scripts/deploy.js): npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox, then a hardhat.config.js pointing at contracts/. Write specs in test/FreelanceMilestoneEscrow.test.js using the toolbox's chai matchers (expect(...).to.be.revertedWithCustomError(...), expect(...).to.emit(...)) plus loadFixture for a fresh-deploy-per-test pattern.
    ◦ Alternative: Foundry (forge test) for tests written in Solidity itself — the README already points at anvil as a suggested local dev chain, so Foundry would reuse that.
2. Run everything against a local chain (npx hardhat node or anvil), never a public testnet.
3. Frontend hook tests: Vitest + @testing-library/react, with a mocked window.ethereum (a hand-rolled EIP-1193 mock, or a library like viem's test client) to exercise useEscrowContract.js without a real wallet or browser extension.
   
**Unit tests (per function)**

Constructor
• Reverts ZeroAddress when _freelancer is address(0).
• Sets client = msg.sender, freelancer = _freelancer, state = AWAITING_PAYMENT.
• Deploying with _freelancer == deployer (client == freelancer) doesn't revert — document the resulting self-dealing behavior rather than assume it's blocked.
depositFunds()
• Reverts Unauthorized when called by anyone other than client (freelancer or a random address).
• Reverts ZeroDeposit when msg.value == 0.
• Reverts InvalidState when called a second time (state already FUNDED).
• Happy path: state moves to FUNDED, getBalance() reflects the deposit, FundsDeposited(client, amount) is emitted with the right args.
releasePayment()
• Reverts Unauthorized when called by anyone other than client.
• Reverts InvalidState when called before funding, or after COMPLETED/REFUNDED.
• Happy path: full balance moves to freelancer, state → COMPLETED, PaymentReleased(freelancer, amount) emitted, contract balance is 0 afterward.
• Reverts TransferFailed when freelancer is a contract whose receive()/fallback() reverts (deploy a malicious receiver as the freelancer address to test this).
refundClient()
• Reverts Unauthorized when called by anyone other than freelancer.
• Reverts InvalidState when called before funding, or after COMPLETED/REFUNDED.
• Happy path: full balance moves to client, state → REFUNDED, ClientRefunded(client, amount) emitted, contract balance is 0 afterward.
• Reverts TransferFailed when client is a contract whose receive()/fallback() reverts.
getBalance()
• Returns 0 before funding.
• Returns the deposited amount while FUNDED.
• Returns 0 after releasePayment() or refundClient().
Reentrancy (CEI check)
• Deploy a malicious freelancer/client contract whose receive() tries to re-enter releasePayment()/refundClient(); confirm the reentrant call reverts with InvalidState (state is already flipped before the external call), proving the checks-effects-interactions ordering actually holds at runtime, not just by inspection.

**Integration tests (end-to-end flows)**
1. Full happy path: deploy → client deposits → client releases → freelancer's balance increases by the deposited amount, contract ends COMPLETED with 0 balance.
2. Full refund path: deploy → client deposits → freelancer refunds → client's balance is restored, contract ends REFUNDED with 0 balance.
3. Out-of-order actions: attempting releasePayment()/refundClient() before any deposit, a second depositFunds() after funding, or either terminal action after the contract already reached COMPLETED/REFUNDED — every case reverts InvalidState and leaves balances untouched.
4. Role-swap attempts: freelancer tries depositFunds()/releasePayment(); client tries refundClient(); an unrelated third address tries any state-changing function — all revert Unauthorized.
5. Race between client and freelancer: both submit releasePayment() and refundClient() in the same block while FUNDED; only the first-processed transaction succeeds, the second reverts InvalidState. Worth an explicit test since it's the one place the two roles' authority genuinely competes.
6. Independent instances: two separately deployed escrows don't share state — funding/releasing one doesn't affect the other (sanity check given the immutable role variables).
7. Frontend hook (useEscrowContract): with a mocked EIP-1193 provider, verify connect() correctly derives isClient/isFreelancer; deposit() rejects a zero or unparseable amount client-side before ever sending a transaction; friendlyError() maps a user-rejected request (code 4001) and a decoded custom error (e.g. InvalidState) to the right message.
8. Event-driven refresh: after FundsDeposited/PaymentReleased/ClientRefunded fires on a mock contract, confirm the hook's refresh() re-fetches client/freelancer/state/getBalance() without needing a page reload.
Security-focused test cases
• Reentrancy: the contract already follows checks-effects-interactions (state is finalized before the external call). Cover it with the malicious-receiver test from Unit tests above rather than relying on code review alone.
• Access control: fuzz over many arbitrary caller addresses (Foundry vm.prank + fuzzing, or a Hardhat loop over random signers) confirming only client can call client-only functions and only freelancer can call freelancer-only ones — broader than the handful of specific addresses in the unit tests.
• Denial of service via a griefing recipient: if releasePayment()'s recipient (freelancer) or refundClient()'s recipient (client) is a contract that always reverts on receiving ETH, that call reverts and the contract is stuck in FUNDED forever — there's no pull-payment fallback. Test this explicitly and flag it in Risks below; it's the most realistic way funds get stuck.
• Forced ETH via selfdestruct: sending ETH to the contract's address via selfdestruct (bypassing depositFunds()) doesn't change state, but does inflate getBalance() and therefore the amount sent on the next releasePayment()/refundClient(). Test that this doesn't break the state machine (it shouldn't) and document that the recipient simply gets a windfall — not an exploit path to steal funds, but worth knowing.
• No receive()/fallback(): a plain ETH transfer straight to the contract address (not via depositFunds()) should revert, since there's no payable fallback. Test this directly.
• Zero-address / self-dealing: constructor already blocks freelancer == address(0); separately test that client == freelancer (self-escrow) doesn't break any invariant — it's allowed but should be a no-op oddity, not a way to double-spend.
• Front-running: low risk here since depositFunds(), releasePayment(), and refundClient() take no attacker-influenced parameters (no slippage, no price, no arbitrary recipient) — there's nothing for a front-runner to sandwich. Worth one test confirming a pending releasePayment() tx can't be reordered to change its outcome.

**Test case matrix**
ID
Area
Case
Priority
U-01
Constructor
Reverts ZeroAddress on _freelancer == 0x0
High
U-02
Constructor
Sets client/freelancer/state correctly
High
U-03
depositFunds
Unauthorized for non-client
High
U-04
depositFunds
ZeroDeposit on msg.value == 0
High
U-05
depositFunds
InvalidState on repeat call
High
U-06
depositFunds
Happy path: state, balance, event
High
U-07
releasePayment
Unauthorized for non-client
High
U-08
releasePayment
InvalidState outside FUNDED
High
U-09
releasePayment
Happy path: transfer, state, event
High
U-10
releasePayment
TransferFailed on reverting recipient
High
U-11
refundClient
Unauthorized for non-freelancer
High
U-12
refundClient
InvalidState outside FUNDED
High
U-13
refundClient
Happy path: transfer, state, event
High
U-14
refundClient
TransferFailed on reverting recipient
High
U-15
getBalance
Correct at each lifecycle stage
Medium
U-16
Reentrancy
Reentrant call reverts InvalidState
High
I-01
Integration
Full happy path (deposit → release)
High
I-02
Integration
Full refund path (deposit → refund)
High
I-03
Integration
Out-of-order calls all revert cleanly
High
I-04
Integration
Role-swap attempts all revert
High
I-05
Integration
Same-block release/refund race
Medium
I-06
Integration
Independent contract instances don't leak state
Low
I-07
Frontend
Hook role detection + client-side validation
Medium
I-08
Frontend
Event-driven state refresh
Medium
S-01
Security
Griefing recipient causes stuck FUNDED state
High
S-02
Security
Forced ETH via selfdestruct doesn't break invariants
Medium
S-03
Security
Direct ETH transfer (no fallback) reverts
Medium
S-04
Security
client == freelancer self-dealing doesn't break invariants
Low
S-05
Security
Access-control fuzzing over random addresses
Medium
Recommended tooling
Purpose
Tool
Notes
Test runner
Hardhat + @nomicfoundation/hardhat-toolbox
Chai matchers for revert/event assertions, loadFixture for clean per-test deploys; pairs naturally with the existing solc 0.8.20 / ethers v6 setup
Test runner (alt.)
Foundry (forge test)
Solidity-native tests, built-in fuzzing (vm.assume), cheatcodes (vm.prank, vm.deal, vm.expectRevert)
Local chain
anvil (Foundry) or npx hardhat node
README already suggests anvil for deploys
Static analysis
Slither
Flags reentrancy, unchecked calls, and similar patterns automatically
Linting
solhint
Style + common-mistake checks
Coverage
solidity-coverage (Hardhat) or forge coverage
Confirms the matrix above actually exercises every branch, especially each custom-error revert path
Frontend tests
Vitest + @testing-library/react
Mock window.ethereum to test useEscrowContract.js in isolation
Frontend e2e (stretch)
Playwright + a wallet automation layer (e.g. Synpress) against a local anvil chain
Only worth it once the unit/integration suite above is solid

**Known gaps and risks**
• No tests exist today — everything above is a from-scratch build; treat this plan as the spec for a first PR, not a checklist against an existing suite.
• No pull-payment escape hatch: if the recipient of releasePayment() or refundClient() reverts on receiving ETH (accidentally or deliberately), funds are stuck in FUNDED with no third way out. The README already calls this a POC ("not audited"), but this is worth flagging explicitly as a design limitation rather than discovering it via a failing test.
• Not audited: the README states this plainly. This test plan improves confidence but doesn't substitute for a professional audit before any real funds are involved.
• Single milestone, no partial release is intentional scope, not a missing feature — worth confirming with whoever owns the roadmap before treating it as a gap to close.
• Frontend correctly has no independent authority checks — all access control lives on-chain, which is the right design. Frontend tests should focus on showing the right actions to the right role, not on security, since the real security boundary is the contract.
