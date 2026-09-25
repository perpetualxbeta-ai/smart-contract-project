# FreelanceMilestoneEscrow — Test Plan

_Last updated: 2026-09-25. Status: automated suites implemented and passing (31 contract tests, 12 frontend tests). Manual end-to-end pass (real wallet) still to be run._

## Overview

This repo is a proof-of-concept single-milestone escrow: one Solidity contract, `contracts/FreelanceMilestoneEscrow.sol` (pragma ^0.8.20), plus a Vite/React frontend that connects to an injected EIP-1193 wallet (Rabby Wallet, or any other). A client deploys the contract naming a freelancer address, funds it, then either releases payment to the freelancer or the freelancer voluntarily refunds the client. All state transitions and transfers are enforced on-chain via a 4-state enum (`AWAITING_PAYMENT → FUNDED → COMPLETED / REFUNDED`).

`scripts/compile.js` calls `solc` directly and `scripts/deploy.js` deploys with ethers v6 against any JSON-RPC endpoint. Hardhat has been added **only for testing**; the compile/deploy scripts are unchanged.

## Scope

**In scope:** the constructor and all four external functions (`depositFunds`, `releasePayment`, `refundClient`, `getBalance`) of the contract, the three public getters (`client`, `freelancer`, `state`), and `frontend/src/hooks/useEscrowContract.js` — the only frontend code that talks to the contract. `App.jsx` and the presentational components are UI-only and are exercised indirectly through the hook.

**Out of scope:** wallet UX polish, gas-optimisation tuning, upgradability, and multi-milestone support (single-milestone is intentional).

**Objective:** prove the state machine can't be driven into an inconsistent state, funds always land with the correct party, both roles are strictly gated, and the escape-hatch refund works under adversarial conditions.

## Test environment

| Item | Implementation |
|---|---|
| Contract tests | Hardhat + `@nomicfoundation/hardhat-toolbox`, `test/FreelanceMilestoneEscrow.test.cjs`, run with `npm test` |
| Config | `hardhat.config.cjs` (`.cjs` because the package is `"type": "module"`). Compiles with the pinned `solc` npm package, so no compiler download is needed |
| Build output | Hardhat writes to `hh-artifacts/`; `artifacts/` stays owned by `scripts/compile.js` |
| Test-only contracts | `contracts/mocks/`: `ClientProxy` (contract client: accept / revert / re-enter modes), `MaliciousFreelancer` (same for the freelancer role), `ForceSend` (selfdestruct ETH injection) |
| Frontend tests | Vitest + `@testing-library/react` + jsdom, `frontend/src/hooks/useEscrowContract.test.jsx`, run with `cd frontend && npm test`. `ethers` `BrowserProvider`/`Contract` and `abi.js` are mocked |
| Local chain | Hardhat's in-process network for automated tests; `npx hardhat node` or `anvil` for manual runs. Automated tests never touch a public network |
| Alternative | Foundry (`forge test`) remains an option for Solidity-native fuzzing |

## Unit tests (per function)

**Constructor**
- Reverts `ZeroAddress` when `_freelancer` is `address(0)`.
- Sets `client = msg.sender`, `freelancer = _freelancer`, `state = AWAITING_PAYMENT`.
- `client == freelancer` does not revert (self-dealing is allowed; see S-04).

**depositFunds()**
- `Unauthorized` for anyone but the client (freelancer or a random address).
- `ZeroDeposit` when `msg.value == 0`. Note the `onlyClient` check runs first, so a non-client sending 0 gets `Unauthorized`.
- `InvalidState` on a second call.
- Happy path: state `FUNDED`, balance updated, `FundsDeposited(client, amount)` emitted.

**releasePayment()**
- `Unauthorized` for anyone but the client.
- `InvalidState` before funding or after `COMPLETED`/`REFUNDED`.
- Happy path: full balance to freelancer, `COMPLETED`, `PaymentReleased(freelancer, amount)` emitted, contract balance 0.
- `TransferFailed` when the freelancer is a contract whose `receive()` reverts; the whole transaction reverts, so state stays `FUNDED` and funds are intact.

**refundClient()**
- `Unauthorized` for anyone but the freelancer.
- `InvalidState` outside `FUNDED`.
- Happy path: full balance to client, `REFUNDED`, `ClientRefunded(client, amount)` emitted, contract balance 0.
- `TransferFailed` when the client is a contract whose `receive()` reverts.

**getBalance()**
- 0 before funding **if no ETH has been force-sent** (see S-06), the deposit while `FUNDED`, and 0 after a terminal state (same caveat).

**Reentrancy (CEI check)**
- A malicious recipient's `receive()` tries to re-enter during payout. The outer call must succeed, the re-entrant calls must fail, and the recipient must be paid exactly once. Expected reverts differ by role:
  - Malicious **freelancer** re-entering `refundClient()` → `InvalidState` (it is authorised, but state is already `COMPLETED`).
  - Malicious freelancer re-entering `releasePayment()` → `Unauthorized` (it is not the client).
  - Malicious **client** re-entering `releasePayment()` during a refund → `InvalidState`.

## Integration tests

| # | Scenario | Automated |
|---|---|---|
| 1 | Happy path: deploy → deposit → release; freelancer +amount, `COMPLETED`, balance 0 | Yes |
| 2 | Refund path: deploy → deposit → refund; client +amount, `REFUNDED`, balance 0 | Yes |
| 3 | Out-of-order calls all revert `InvalidState` (including after a terminal state) | Yes |
| 4 | Role violations all revert `Unauthorized` | Yes |
| 5 | Same-block race: both txs mined in one block (automine off); exactly one succeeds, the other fails, and a replay of either now reverts `InvalidState` | Yes |
| 6 | Independent deployments do not share state | Yes |
| 7 | Frontend hook: role detection (case-insensitive, no `isMetaMask` dependency), client-side deposit validation (`0`, empty, non-numeric), error mapping (code 4001, decoded custom error, `shortMessage` fallback), no-wallet error | Yes (mocked) |
| 8 | Event-driven refresh: hook subscribes to all three events and re-fetches state when one fires; account disconnect clears state | Yes (mocked) |
| 9 | **Manual end-to-end with a real wallet** — see below | No |

## Security-focused test cases

- **Reentrancy** — covered by the malicious-receiver tests (U-16).
- **Access control fuzzing (S-05)** — 25 random funded wallets each attempt all three restricted functions; every call must revert `Unauthorized`.
- **Griefing recipient (S-01)** — a freelancer contract that reverts on receive makes `releasePayment()` revert. Funds stay in `FUNDED` for **as long as the recipient keeps reverting**; the test also shows that if the recipient later starts accepting ETH the release succeeds. There is no pull-payment fallback, so a contract recipient that reverts permanently (and cannot call `refundClient()`) locks the funds.
- **Forced ETH via selfdestruct (S-02, S-06)** — does not change state. It inflates `getBalance()`, and the extra ETH is paid out with the next release/refund (a windfall, not a theft path). Two edge cases are also covered: ETH forced in *before* funding makes `getBalance()` non-zero while `AWAITING_PAYMENT`, and ETH forced in *after* a terminal state is **permanently locked** (there is no withdraw function).
- **No `receive()`/`fallback()` (S-03)** — plain ETH transfers and unknown-selector calls revert.
- **Self-dealing (S-04)** — `client == freelancer` completes the lifecycle without breaking any invariant.
- **Front-running** — low risk: no function takes attacker-influenced parameters. The same-block race test (I-05) shows transaction ordering only decides *which* legitimate action wins, and the loser cleanly reverts.

## Test case matrix

| ID | Area | Case | Priority | Status |
|---|---|---|---|---|
| U-01 | Constructor | Reverts `ZeroAddress` | High | Done |
| U-02 | Constructor | Sets client/freelancer/state | High | Done |
| U-03 | depositFunds | `Unauthorized` for non-client | High | Done |
| U-04 | depositFunds | `ZeroDeposit` | High | Done |
| U-05 | depositFunds | `InvalidState` on repeat | High | Done |
| U-06 | depositFunds | Happy path: state, balance, event | High | Done |
| U-07 | releasePayment | `Unauthorized` for non-client | High | Done |
| U-08 | releasePayment | `InvalidState` outside FUNDED | High | Done |
| U-09 | releasePayment | Happy path: transfer, state, event | High | Done |
| U-10 | releasePayment | `TransferFailed` on reverting recipient | High | Done |
| U-11 | refundClient | `Unauthorized` for non-freelancer | High | Done |
| U-12 | refundClient | `InvalidState` outside FUNDED | High | Done |
| U-13 | refundClient | Happy path: transfer, state, event | High | Done |
| U-14 | refundClient | `TransferFailed` on reverting recipient | High | Done |
| U-15 | getBalance | Correct at each lifecycle stage | Medium | Done |
| U-16 | Reentrancy | Re-entrant calls revert (`InvalidState`/`Unauthorized`), single payout | High | Done |
| I-01 | Integration | Full happy path | High | Done |
| I-02 | Integration | Full refund path | High | Done |
| I-03 | Integration | Out-of-order calls revert cleanly | High | Done |
| I-04 | Integration | Role-swap attempts revert | High | Done |
| I-05 | Integration | Same-block release/refund race | Medium | Done |
| I-06 | Integration | Independent instances | Low | Done |
| I-07 | Frontend | Hook role detection, validation, error mapping | Medium | Done (mocked) |
| I-08 | Frontend | Event-driven refresh | Medium | Done (mocked) |
| S-01 | Security | Griefing recipient leaves funds in FUNDED | High | Done |
| S-02 | Security | Forced ETH doesn't break invariants | Medium | Done |
| S-03 | Security | Direct ETH transfer reverts | Medium | Done |
| S-04 | Security | Self-dealing doesn't break invariants | Low | Done |
| S-05 | Security | Access-control fuzzing | Medium | Done |
| S-06 | Security | Forced ETH before funding / after terminal state | Low | Done |
| E-01 | Manual E2E | Real-wallet happy path on local chain / Sepolia (two wallets) | High | To do |
| E-02 | Manual E2E | Real-wallet refund path | High | To do |
| E-03 | Manual E2E | Third wallet sees status but no action buttons | Medium | To do |
| E-04 | Manual E2E | Wallet switch / reject-in-wallet / wrong network behaviour | Medium | To do |

## Manual end-to-end pass (not automated)

The automated frontend tests mock the wallet, so the following needs a person and a real wallet:

1. Start a chain (`npx hardhat node` or `anvil`), or use Sepolia.
2. Set `.env` (`RPC_URL`, `PRIVATE_KEY` of the client, `FREELANCER_ADDRESS`), run `npm run compile && npm run deploy`, and put the address in `frontend/.env` as `VITE_CONTRACT_ADDRESS`.
3. Run `cd frontend && npm run dev`, and open it in **two browser profiles**, each with its own Rabby wallet (client and freelancer), plus a third profile for a stranger.
4. Walk E-01 to E-04 and confirm the UI live-updates in the other profile without a reload.

Accounts needed: three fresh test-only wallets (client, freelancer, stranger); for Sepolia, an RPC provider key (Alchemy/Infura) and Sepolia test ETH for the client wallet; optionally an Etherscan key. Never reuse a key that has held real funds.

## Recommended tooling

| Purpose | Tool | Status |
|---|---|---|
| Test runner | Hardhat + hardhat-toolbox | In place |
| Test runner (alt.) | Foundry (`forge test`) | Optional |
| Local chain | Hardhat node / anvil | Available |
| Coverage | `solidity-coverage` (`npm run test:coverage`) | Script added, **not yet run** — confirm every custom-error branch is hit |
| Static analysis | Slither | Not yet run |
| Linting | solhint | Not yet configured |
| Frontend tests | Vitest + Testing Library | In place |
| Frontend e2e (stretch) | Playwright + wallet automation (e.g. Synpress) | Only worth it once the above is solid |

## Known gaps and risks

- **No pull-payment escape hatch:** a recipient contract that permanently reverts on receiving ETH locks the funds in `FUNDED`. Documented as a POC limitation (S-01), not fixed.
- **Forced ETH is unrecoverable after a terminal state** (S-06), and `getBalance()` can be non-zero outside `FUNDED`. Harmless to the state machine but worth knowing; any UI should not treat a non-zero balance as proof of funding.
- **Frontend is mocked, not browser-tested:** wallet-specific behaviour (Rabby prompts, network switching) is only covered by the manual pass (E-01 to E-04).
- **Coverage and static analysis not yet measured** (see tooling).
- **Not audited:** this plan improves confidence but is no substitute for a professional audit before real funds are involved.
- **Single milestone, no partial release** is intentional scope.
- **Frontend has no independent authority checks:** `isClient`/`isFreelancer` in the hook only decide which buttons to show; the security boundary is the contract.
