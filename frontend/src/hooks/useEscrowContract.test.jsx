import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const CLIENT = "0x1111111111111111111111111111111111111111";
const FREELANCER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";

vi.mock("../abi.js", () => ({
  CONTRACT_ADDRESS: "0x9999999999999999999999999999999999999999",
  ESCROW_ABI: [],
  ESCROW_STATE_LABELS: ["AWAITING_PAYMENT", "FUNDED", "COMPLETED", "REFUNDED"],
}));

// Shared mutable mock state, reconfigured per test.
const mock = { contract: null, listeners: {} };

vi.mock("ethers", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    BrowserProvider: vi.fn().mockImplementation(() => ({ getSigner: async () => ({}) })),
    Contract: vi.fn().mockImplementation(() => mock.contract),
  };
});

import { useEscrowContract } from "./useEscrowContract.js";

function makeContract({ state = 0, balance = 0n } = {}) {
  const c = {
    _state: state,
    _balance: balance,
    client: vi.fn(async () => CLIENT),
    freelancer: vi.fn(async () => FREELANCER),
    state: vi.fn(async () => c._state),
    getBalance: vi.fn(async () => c._balance),
    depositFunds: vi.fn(async () => ({ wait: async () => {} })),
    releasePayment: vi.fn(async () => ({ wait: async () => {} })),
    refundClient: vi.fn(async () => ({ wait: async () => {} })),
    on: vi.fn((evt, fn) => { (mock.listeners[evt] ||= []).push(fn); }),
    off: vi.fn(),
  };
  return c;
}

function installWallet(account, requestImpl) {
  window.ethereum = {
    request: requestImpl || vi.fn(async () => [account]),
    on: vi.fn(),
    removeListener: vi.fn(),
    isMetaMask: false, // Rabby-style: must still work
  };
}

beforeEach(() => {
  mock.listeners = {};
  mock.contract = makeContract();
  delete window.ethereum;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("useEscrowContract (I-07: role detection, validation, error mapping)", () => {
  it("errors when no injected wallet exists", async () => {
    const { result } = renderHook(() => useEscrowContract());
    await act(() => result.current.connect());
    expect(result.current.error).toMatch(/No injected wallet/);
    expect(result.current.account).toBeNull();
  });

  it.each([
    ["client", CLIENT, { isClient: true, isFreelancer: false }],
    ["freelancer", FREELANCER, { isClient: false, isFreelancer: true }],
    ["stranger", STRANGER, { isClient: false, isFreelancer: false }],
  ])("detects role: %s (case-insensitive) without requiring isMetaMask", async (_n, addr, expected) => {
    installWallet(addr.toUpperCase().replace("0X", "0x"));
    const { result } = renderHook(() => useEscrowContract());
    await act(() => result.current.connect());
    expect(window.ethereum.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    expect(result.current.isClient).toBe(expected.isClient);
    expect(result.current.isFreelancer).toBe(expected.isFreelancer);
  });

  it("reads escrow state and formats balance", async () => {
    mock.contract = makeContract({ state: 1, balance: 1500000000000000000n });
    installWallet(CLIENT);
    const { result } = renderHook(() => useEscrowContract());
    await act(() => result.current.connect());
    expect(result.current.escrowStateLabel).toBe("FUNDED");
    expect(result.current.balance).toBe("1.5");
  });

  it("maps wallet rejection (code 4001) to a friendly message", async () => {
    installWallet(CLIENT, vi.fn(async () => { throw { code: 4001 }; }));
    const { result } = renderHook(() => useEscrowContract());
    await act(() => result.current.connect());
    expect(result.current.error).toBe("Request was rejected in your wallet.");
  });

  it("deposit: rejects zero, negative-ish and non-numeric amounts without sending a tx", async () => {
    installWallet(CLIENT);
    const { result } = renderHook(() => useEscrowContract());
    await act(() => result.current.connect());

    await act(() => result.current.deposit("0"));
    expect(result.current.error).toBe("Deposit amount must be greater than 0.");
    await act(() => result.current.deposit("abc"));
    expect(result.current.error).toBe("Enter a valid ETH amount.");
    await act(() => result.current.deposit(""));
    expect(result.current.error).toBe("Deposit amount must be greater than 0.");
    expect(mock.contract.depositFunds).not.toHaveBeenCalled();
  });

  it("deposit: sends parsed value and refreshes state", async () => {
    installWallet(CLIENT);
    const { result } = renderHook(() => useEscrowContract());
    await act(() => result.current.connect());
    mock.contract._state = 1;
    mock.contract._balance = 2000000000000000000n;
    await act(() => result.current.deposit("2"));
    expect(mock.contract.depositFunds).toHaveBeenCalledWith({ value: 2000000000000000000n });
    expect(result.current.escrowStateLabel).toBe("FUNDED");
    expect(result.current.error).toBeNull();
  });

  it("maps decoded custom-error reverts to 'Reverted: <Name>'", async () => {
    installWallet(CLIENT);
    const { result } = renderHook(() => useEscrowContract());
    await act(() => result.current.connect());
    mock.contract.releasePayment.mockRejectedValueOnce({ revert: { name: "InvalidState" } });
    await act(() => result.current.release());
    expect(result.current.error).toBe("Reverted: InvalidState");
    expect(result.current.isPending).toBe(false);
  });

  it("falls back to shortMessage for unknown errors", async () => {
    installWallet(FREELANCER);
    const { result } = renderHook(() => useEscrowContract());
    await act(() => result.current.connect());
    mock.contract.refundClient.mockRejectedValueOnce({ shortMessage: "boom" });
    await act(() => result.current.refund());
    expect(result.current.error).toBe("boom");
  });
});

describe("useEscrowContract (I-08: event-driven refresh)", () => {
  it("subscribes to all three events and re-fetches state when one fires", async () => {
    installWallet(CLIENT);
    const { result } = renderHook(() => useEscrowContract());
    await act(() => result.current.connect());

    await waitFor(() => expect(mock.contract.on).toHaveBeenCalledTimes(3));
    const events = mock.contract.on.mock.calls.map((c) => c[0]).sort();
    expect(events).toEqual(["ClientRefunded", "FundsDeposited", "PaymentReleased"]);

    mock.contract._state = 2;
    await act(async () => { await mock.listeners["PaymentReleased"][0](); });
    await waitFor(() => expect(result.current.escrowStateLabel).toBe("COMPLETED"));
  });

  it("re-connects when the wallet switches accounts, clears on disconnect", async () => {
    installWallet(CLIENT);
    const { result } = renderHook(() => useEscrowContract());
    await act(() => result.current.connect());
    const onAccountsChanged = window.ethereum.on.mock.calls.find((c) => c[0] === "accountsChanged")[1];

    await act(async () => { onAccountsChanged([]); });
    expect(result.current.account).toBeNull();
  });
});
