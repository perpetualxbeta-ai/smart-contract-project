import { useState } from "react";
import { useEscrowContract } from "./hooks/useEscrowContract.js";
import StatusBadge from "./components/StatusBadge.jsx";
import AddressPill from "./components/AddressPill.jsx";

function truncate(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function App() {
  const {
    account,
    client,
    freelancer,
    escrowStateLabel,
    balance,
    error,
    isConnecting,
    isPending,
    connect,
    deposit,
    release,
    refund,
    isClient,
    isFreelancer,
  } = useEscrowContract();

  const [amount, setAmount] = useState("0.1");

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Freelance Milestone Escrow</h1>
          <p className="app__subtitle">Trust-minimized escrow for a single freelance milestone.</p>
        </div>

        {account ? (
          <div className="wallet-chip">
            <span className="wallet-chip__dot" />
            {truncate(account)}
          </div>
        ) : (
          <button className="btn btn--primary" onClick={connect} disabled={isConnecting}>
            {isConnecting ? "Connecting..." : "Connect Wallet"}
          </button>
        )}
      </header>

      {error && <div className="banner banner--error">{error}</div>}

      {account ? (
        <main className="card">
          {escrowStateLabel && <StatusBadge stateLabel={escrowStateLabel} />}

          <div className="pills">
            <AddressPill label="Client" address={client} highlight={isClient} />
            <AddressPill label="Freelancer" address={freelancer} highlight={isFreelancer} />
          </div>

          <div className="balance">
            <span className="balance__label">Escrow Balance</span>
            <span className="balance__value">{balance} ETH</span>
          </div>

          <div className="role-tag">
            Connected as: <strong>{isClient ? "Client" : isFreelancer ? "Freelancer" : "Observer"}</strong>
          </div>

          <div className="actions">
            {isClient && escrowStateLabel === "AWAITING_PAYMENT" && (
              <div className="deposit-form">
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={isPending}
                  aria-label="Deposit amount in ETH"
                />
                <button className="btn btn--neon" onClick={() => deposit(amount)} disabled={isPending}>
                  {isPending ? "Depositing..." : "Deposit Funds"}
                </button>
              </div>
            )}

            {isClient && escrowStateLabel === "FUNDED" && (
              <button className="btn btn--neon" onClick={release} disabled={isPending}>
                {isPending ? "Releasing..." : "Approve Work & Release Payment"}
              </button>
            )}

            {isFreelancer && escrowStateLabel === "FUNDED" && (
              <button className="btn btn--danger" onClick={refund} disabled={isPending}>
                {isPending ? "Refunding..." : "Refund Client (Escape Hatch)"}
              </button>
            )}

            {escrowStateLabel === "COMPLETED" && (
              <p className="done-note">Payment released to the freelancer. Milestone complete.</p>
            )}
            {escrowStateLabel === "REFUNDED" && (
              <p className="done-note">Funds returned to the client.</p>
            )}
            {!isClient && !isFreelancer && escrowStateLabel && (
              <p className="observer-note">
                Connect with the client or freelancer wallet to take action on this escrow.
              </p>
            )}
          </div>
        </main>
      ) : (
        <main className="card card--empty">
          <p>Connect your wallet (Rabby recommended) to view and interact with the escrow.</p>
        </main>
      )}

      <footer className="app__footer">POC — not audited. Do not use with real funds.</footer>
    </div>
  );
}
