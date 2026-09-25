# Diagrams

Visual guide to how the escrow contract, the React frontend and a wallet fit together. All diagrams use [Mermaid](https://mermaid.js.org/), which GitHub renders natively in Markdown.

Contents:

1. [Architecture at a glance](#1-architecture-at-a-glance)
2. [Sequence diagrams](#2-sequence-diagrams): [connect](#21-connect-wallet-and-load-state) · [`depositFunds()`](#22-depositfunds) · [`releasePayment()`](#23-releasepayment) · [`refundClient()`](#24-refundclient)
3. [State machine](#3-state-machine) and [transition table](#transition-table)

Source of truth: `contracts/FreelanceMilestoneEscrow.sol` and `frontend/src/hooks/useEscrowContract.js`. If either changes, update these diagrams.

---

## 1. Architecture at a glance

```mermaid
flowchart LR
    User([User])
    subgraph Browser
        Wallet["Wallet<br/>(Rabby or any EIP-1193 wallet)<br/>holds keys, signs txs"]
        subgraph Frontend["Frontend (Vite + React)"]
            App["App.jsx<br/>shows buttons by role + state"]
            Hook["useEscrowContract.js<br/>connect, deposit, release, refund,<br/>refresh, event listeners"]
            Ethers["Ethers.js v6<br/>BrowserProvider + Contract"]
        end
    end
    RPC["JSON-RPC node<br/>(local anvil / Hardhat, or Sepolia)"]
    subgraph EVM["EVM"]
        Escrow["FreelanceMilestoneEscrow<br/>state, client, freelancer"]
    end

    User --> App
    App --> Hook --> Ethers
    Ethers <-->|"window.ethereum<br/>(EIP-1193)"| Wallet
    Wallet <-->|signed txs, eth_call| RPC
    RPC <--> Escrow
    Escrow -. "events: FundsDeposited,<br/>PaymentReleased, ClientRefunded" .-> Ethers

    Env[".env<br/>VITE_CONTRACT_ADDRESS"] -. "baked in at Vite build/dev start<br/>(import.meta.env)" .-> Hook
```

Notes:

- **Vite** is a build and dev-server tool, not a runtime actor. It bundles the app and injects `VITE_CONTRACT_ADDRESS` from `frontend/.env`. Changing the address means restarting `npm run dev`.
- **The wallet** is the only thing that holds keys. The frontend never sees a private key.
- **The contract** enforces every rule. The frontend only hides buttons that would revert; it does not protect anything.

---

## 2. Sequence diagrams

Common cast in all diagrams below:

- **User**: the person clicking in the browser.
- **Wallet**: Rabby or another injected wallet (`window.ethereum`).
- **Frontend**: `App.jsx` plus the `useEscrowContract` hook.
- **Ethers.js / Vite**: Ethers v6 (`BrowserProvider`, `Contract`), bundled and configured by Vite.
- **Smart Contract (EVM)**: `FreelanceMilestoneEscrow`.

### 2.1 Connect wallet and load state

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Wallet as Wallet (Rabby / EIP-1193)
    participant FE as Frontend (React + hook)
    participant Eth as Ethers.js / Vite
    participant SC as Smart Contract (EVM)

    Note over Eth: Vite injected VITE_CONTRACT_ADDRESS at build time
    User->>FE: Click "Connect Wallet"
    alt no window.ethereum
        FE-->>User: Error "No injected wallet found..."
    else VITE_CONTRACT_ADDRESS not set
        FE-->>User: Error "VITE_CONTRACT_ADDRESS is not set..."
    else ok
        FE->>Wallet: request eth_requestAccounts
        Wallet->>User: Approve connection?
        User-->>Wallet: Approve
        Wallet-->>FE: accounts[0]
        FE->>Eth: new BrowserProvider(window.ethereum).getSigner()
        FE->>Eth: new Contract(address, ABI, signer)
        par read on-chain state
            Eth->>SC: client()
            Eth->>SC: freelancer()
            Eth->>SC: state()
            Eth->>SC: getBalance()
        end
        SC-->>Eth: addresses, state enum, balance (wei)
        Eth-->>FE: values
        FE->>FE: isClient / isFreelancer = compare account to client / freelancer
        FE-->>User: Status badge, balance, role, role-appropriate buttons
        FE->>Eth: contract.on(FundsDeposited, PaymentReleased, ClientRefunded)
    end
```

If the user rejects the connection (error code `4001`), the hook shows "Request was rejected in your wallet." Switching account or network in the wallet triggers `accountsChanged` / `chainChanged`, and the hook reconnects.

### 2.2 `depositFunds()`

Only the client can deposit, and only while the state is `AWAITING_PAYMENT`.

```mermaid
sequenceDiagram
    autonumber
    actor User as User (client)
    participant Wallet as Wallet (Rabby / EIP-1193)
    participant FE as Frontend (React + hook)
    participant Eth as Ethers.js / Vite
    participant SC as Smart Contract (EVM)

    Note over FE: "Deposit Funds" is only shown if isClient and state is AWAITING_PAYMENT
    User->>FE: Enter amount, click "Deposit Funds"
    FE->>FE: parseEther(amount)
    alt not a number or amount <= 0
        FE-->>User: Error "Enter a valid ETH amount." / "must be greater than 0" (no tx sent)
    else valid
        FE->>Eth: contract.depositFunds({ value })
        Eth->>SC: eth_estimateGas (simulates the call)
        alt simulation reverts
            SC-->>Eth: revert Unauthorized / InvalidState / ZeroDeposit
            Eth-->>FE: error with decoded revert name
            FE-->>User: "Reverted: <ErrorName>" (wallet never opens)
        else simulation ok
            Eth->>Wallet: eth_sendTransaction
            Wallet->>User: Confirm transaction and gas?
            alt user rejects
                User-->>Wallet: Reject
                Wallet-->>FE: error 4001
                FE-->>User: "Request was rejected in your wallet."
            else user confirms
                User-->>Wallet: Confirm (signs)
                Wallet->>SC: Signed tx broadcast to the node
                Note over SC: onlyClient, then inState(AWAITING_PAYMENT), then msg.value != 0
                SC->>SC: state = FUNDED
                SC-->>Eth: Receipt + event FundsDeposited(client, amount)
                Eth-->>FE: tx.wait() resolves
                FE->>Eth: refresh()
                Eth->>SC: client(), freelancer(), state(), getBalance()
                SC-->>FE: state = FUNDED, balance = amount
                FE-->>User: Badge FUNDED, balance shown, "Release" (client) / "Refund" (freelancer)
            end
        end
    end
```

If the state changes between the simulation and mining (for example someone else's transaction lands first), the transaction can still revert on-chain. `tx.wait()` then throws and the hook shows the error the same way.

### 2.3 `releasePayment()`

Only the client can release, and only while the state is `FUNDED`. The whole balance goes to the freelancer.

```mermaid
sequenceDiagram
    autonumber
    actor User as User (client)
    participant Wallet as Wallet (Rabby / EIP-1193)
    participant FE as Frontend (React + hook)
    participant Eth as Ethers.js / Vite
    participant SC as Smart Contract (EVM)
    participant FL as Freelancer address

    Note over FE: "Approve Work & Release Payment" is only shown if isClient and state is FUNDED
    User->>FE: Click "Approve Work & Release Payment"
    FE->>Eth: contract.releasePayment()
    Eth->>SC: eth_estimateGas (simulates the call, including the payout)
    alt simulation reverts
        SC-->>Eth: revert Unauthorized / InvalidState / TransferFailed
        Eth-->>FE: error with decoded revert name
        FE-->>User: "Reverted: <ErrorName>" (wallet never opens)
    else simulation ok
        Eth->>Wallet: eth_sendTransaction
        Wallet->>User: Confirm transaction and gas?
        alt user rejects
            Wallet-->>FE: error 4001
            FE-->>User: "Request was rejected in your wallet."
        else user confirms
            Wallet->>SC: Signed tx broadcast
            Note over SC: onlyClient, then inState(FUNDED)
            SC->>SC: amount = balance, state = COMPLETED (effects first)
            SC->>FL: call{value: amount}("")
            alt freelancer accepts ETH
                FL-->>SC: success
                SC-->>Eth: Receipt + event PaymentReleased(freelancer, amount)
                Eth-->>FE: tx.wait() resolves
                FE->>Eth: refresh()
                Eth->>SC: client(), freelancer(), state(), getBalance()
                SC-->>FE: state = COMPLETED, balance = 0
                FE-->>User: "Payment released to the freelancer. Milestone complete."
            else freelancer contract rejects ETH
                FL-->>SC: revert
                SC-->>Wallet: revert TransferFailed (whole tx undone, state stays FUNDED)
                Wallet-->>FE: failed transaction
                FE-->>User: "Reverted: TransferFailed"
            end
        end
    end
```

Because `state = COMPLETED` is set before the payout call, a recipient that tries to call back into the escrow while being paid is refused (`InvalidState`), so it can only be paid once.

### 2.4 `refundClient()`

Only the freelancer can refund, and only while the state is `FUNDED`. The whole balance goes back to the client. This is the escape hatch.

```mermaid
sequenceDiagram
    autonumber
    actor User as User (freelancer)
    participant Wallet as Wallet (Rabby / EIP-1193)
    participant FE as Frontend (React + hook)
    participant Eth as Ethers.js / Vite
    participant SC as Smart Contract (EVM)
    participant CL as Client address

    Note over FE: "Refund Client (Escape Hatch)" is only shown if isFreelancer and state is FUNDED
    User->>FE: Click "Refund Client (Escape Hatch)"
    FE->>Eth: contract.refundClient()
    Eth->>SC: eth_estimateGas (simulates the call, including the payout)
    alt simulation reverts
        SC-->>Eth: revert Unauthorized / InvalidState / TransferFailed
        Eth-->>FE: error with decoded revert name
        FE-->>User: "Reverted: <ErrorName>" (wallet never opens)
    else simulation ok
        Eth->>Wallet: eth_sendTransaction
        Wallet->>User: Confirm transaction and gas?
        alt user rejects
            Wallet-->>FE: error 4001
            FE-->>User: "Request was rejected in your wallet."
        else user confirms
            Wallet->>SC: Signed tx broadcast
            Note over SC: onlyFreelancer, then inState(FUNDED)
            SC->>SC: amount = balance, state = REFUNDED (effects first)
            SC->>CL: call{value: amount}("")
            alt client accepts ETH
                CL-->>SC: success
                SC-->>Eth: Receipt + event ClientRefunded(client, amount)
                Eth-->>FE: tx.wait() resolves
                FE->>Eth: refresh()
                Eth->>SC: client(), freelancer(), state(), getBalance()
                SC-->>FE: state = REFUNDED, balance = 0
                FE-->>User: "Funds returned to the client."
            else client contract rejects ETH
                CL-->>SC: revert
                SC-->>Wallet: revert TransferFailed (whole tx undone, state stays FUNDED)
                Wallet-->>FE: failed transaction
                FE-->>User: "Reverted: TransferFailed"
            end
        end
    end
```

### Live updates in the other person's browser

The hook listens for `FundsDeposited`, `PaymentReleased` and `ClientRefunded`. When any of them is emitted, every connected browser calls `refresh()` and re-reads `client()`, `freelancer()`, `state()` and `getBalance()`. That is why the freelancer's screen updates by itself after the client deposits, with no page reload.

---

## 3. State machine

```mermaid
stateDiagram-v2
    direction TB

    [*] --> AWAITING_PAYMENT : constructor(_freelancer) by deployer (becomes client)

    AWAITING_PAYMENT --> FUNDED : depositFunds() by client with value above 0

    FUNDED --> COMPLETED : releasePayment() by client, pays freelancer
    FUNDED --> REFUNDED : refundClient() by freelancer, pays client

    COMPLETED --> [*]
    REFUNDED --> [*]

    AWAITING_PAYMENT --> AWAITING_PAYMENT : depositFunds() by non-client reverts Unauthorized
    AWAITING_PAYMENT --> AWAITING_PAYMENT : depositFunds() with 0 ETH reverts ZeroDeposit
    AWAITING_PAYMENT --> AWAITING_PAYMENT : releasePayment() or refundClient() reverts InvalidState

    FUNDED --> FUNDED : depositFunds() again reverts InvalidState
    FUNDED --> FUNDED : release by non-client, refund by non-freelancer reverts Unauthorized
    FUNDED --> FUNDED : recipient rejects ETH reverts TransferFailed

    COMPLETED --> COMPLETED : any state-changing call reverts InvalidState
    REFUNDED --> REFUNDED : any state-changing call reverts InvalidState
```

Reading the diagram:

- The four forward arrows are the only ways state ever changes. Every arrow that loops back to the same state is a **revert**: the transaction is undone and nothing changes (only gas is spent).
- `COMPLETED` and `REFUNDED` are terminal. Nothing can move the escrow out of them.
- Order of checks inside each function: **role first** (`Unauthorized`), **then state** (`InvalidState`), **then amount** (`ZeroDeposit`). So a stranger calling `depositFunds()` with 0 ETH gets `Unauthorized`, not `ZeroDeposit`.
- `TransferFailed` happens after the state was set, but because the whole transaction reverts, the state is rolled back to `FUNDED`. Funds are not lost, but they stay stuck for as long as the recipient keeps rejecting ETH (there is no pull-payment fallback).
- The constructor also reverts with `ZeroAddress` if `_freelancer` is `address(0)`, so no escrow is created.

### Transition table

Who may call what, and what happens. "Revert" means nothing changes.

| Function | Caller | `AWAITING_PAYMENT` | `FUNDED` | `COMPLETED` / `REFUNDED` |
|---|---|---|---|---|
| `depositFunds()` | client | To `FUNDED` (if value > 0, else `ZeroDeposit`) | Revert `InvalidState` | Revert `InvalidState` |
| `depositFunds()` | anyone else | Revert `Unauthorized` | Revert `Unauthorized` | Revert `Unauthorized` |
| `releasePayment()` | client | Revert `InvalidState` | To `COMPLETED` (or `TransferFailed` if the freelancer rejects ETH) | Revert `InvalidState` |
| `releasePayment()` | anyone else | Revert `Unauthorized` | Revert `Unauthorized` | Revert `Unauthorized` |
| `refundClient()` | freelancer | Revert `InvalidState` | To `REFUNDED` (or `TransferFailed` if the client rejects ETH) | Revert `InvalidState` |
| `refundClient()` | anyone else | Revert `Unauthorized` | Revert `Unauthorized` | Revert `Unauthorized` |
| `getBalance()` | anyone | Returns balance | Returns balance | Returns balance |
| plain ETH transfer | anyone | Reverts (no `receive`/`fallback`) | Reverts | Reverts |

Each row corresponds to tests in `test/FreelanceMilestoneEscrow.test.cjs` (see `test_plan.md`, IDs U-03 to U-14, I-03, I-04, S-03). You can also play these transitions in `docs/simulator.html`.
