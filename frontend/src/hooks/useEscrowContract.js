import { useCallback, useEffect, useRef, useState } from "react";
import { BrowserProvider, Contract, formatEther, parseEther } from "ethers";
import { CONTRACT_ADDRESS, ESCROW_ABI, ESCROW_STATE_LABELS } from "../abi.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function friendlyError(err) {
  if (err?.code === 4001 || err?.code === "ACTION_REJECTED") {
    return "Request was rejected in your wallet.";
  }
  // ethers v6 decodes known custom errors onto err.revert when the ABI is available.
  if (err?.revert?.name) {
    return `Reverted: ${err.revert.name}`;
  }
  return err?.shortMessage || err?.reason || err?.message || "Something went wrong.";
}

/**
 * Wallet + contract wiring for the FreelanceMilestoneEscrow POC.
 * Uses a plain EIP-1193 `eth_requestAccounts` call so it works with
 * Rabby Wallet (and any other injected wallet) without checking
 * `window.ethereum.isMetaMask`.
 */
export function useEscrowContract() {
  const [account, setAccount] = useState(null);
  const [client, setClient] = useState(ZERO_ADDRESS);
  const [freelancer, setFreelancer] = useState(ZERO_ADDRESS);
  const [escrowState, setEscrowState] = useState(null);
  const [balance, setBalance] = useState("0");
  const [error, setError] = useState(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const contractRef = useRef(null);

  const refresh = useCallback(async (contractOverride) => {
    const c = contractOverride || contractRef.current;
    if (!c) return;
    try {
      const [clientAddr, freelancerAddr, stateValue, bal] = await Promise.all([
        c.client(),
        c.freelancer(),
        c.state(),
        c.getBalance(),
      ]);
      setClient(clientAddr);
      setFreelancer(freelancerAddr);
      setEscrowState(Number(stateValue));
      setBalance(formatEther(bal));
    } catch (err) {
      console.error("Failed to read escrow state:", err);
      setError(friendlyError(err));
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);

    if (typeof window === "undefined" || !window.ethereum) {
      setError("No injected wallet found. Install Rabby Wallet and reload the page.");
      return;
    }
    if (!CONTRACT_ADDRESS) {
      setError("VITE_CONTRACT_ADDRESS is not set. Deploy the contract and configure frontend/.env.");
      return;
    }

    setIsConnecting(true);
    try {
      // Generic EIP-1193 call. Deliberately NOT gated on `isMetaMask` so
      // Rabby (which also injects window.ethereum) is treated normally.
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const browserProvider = new BrowserProvider(window.ethereum);
      const signer = await browserProvider.getSigner();
      const escrow = new Contract(CONTRACT_ADDRESS, ESCROW_ABI, signer);

      contractRef.current = escrow;
      setAccount(accounts[0]);

      await refresh(escrow);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setIsConnecting(false);
    }
  }, [refresh]);

  // Keep the UI in sync when the user switches accounts/networks in their wallet.
  useEffect(() => {
    if (typeof window === "undefined" || !window.ethereum) return undefined;

    const handleAccountsChanged = (accounts) => {
      if (!accounts || accounts.length === 0) {
        setAccount(null);
        contractRef.current = null;
      } else {
        connect();
      }
    };
    const handleChainChanged = () => connect();

    window.ethereum.on?.("accountsChanged", handleAccountsChanged);
    window.ethereum.on?.("chainChanged", handleChainChanged);
    return () => {
      window.ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live-update the UI on contract events instead of requiring a page reload.
  useEffect(() => {
    const c = contractRef.current;
    if (!account || !c) return undefined;

    const onChange = () => refresh(c);
    c.on("FundsDeposited", onChange);
    c.on("PaymentReleased", onChange);
    c.on("ClientRefunded", onChange);
    return () => {
      c.off("FundsDeposited", onChange);
      c.off("PaymentReleased", onChange);
      c.off("ClientRefunded", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, refresh]);

  const runTx = useCallback(
    async (methodName, ...args) => {
      if (!contractRef.current) return;
      setError(null);
      setIsPending(true);
      try {
        const tx = await contractRef.current[methodName](...args);
        await tx.wait();
        await refresh();
      } catch (err) {
        setError(friendlyError(err));
      } finally {
        setIsPending(false);
      }
    },
    [refresh]
  );

  const deposit = useCallback(
    async (amountEth) => {
      let value;
      try {
        value = parseEther(String(amountEth || "0"));
      } catch {
        setError("Enter a valid ETH amount.");
        return;
      }
      if (value <= 0n) {
        setError("Deposit amount must be greater than 0.");
        return;
      }
      await runTx("depositFunds", { value });
    },
    [runTx]
  );

  const release = useCallback(() => runTx("releasePayment"), [runTx]);
  const refund = useCallback(() => runTx("refundClient"), [runTx]);

  const isClient = Boolean(account && client && account.toLowerCase() === client.toLowerCase());
  const isFreelancer = Boolean(
    account && freelancer && account.toLowerCase() === freelancer.toLowerCase()
  );

  return {
    account,
    client,
    freelancer,
    escrowState,
    escrowStateLabel: escrowState !== null ? ESCROW_STATE_LABELS[escrowState] : null,
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
  };
}
