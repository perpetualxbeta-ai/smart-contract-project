// Auto-derived from artifacts/FreelanceMilestoneEscrow.json (Phase 1 compile output).
// Keep this in sync if the contract changes.

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS || "";

export const ESCROW_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "_freelancer", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  { "inputs": [], "name": "InvalidState", "type": "error" },
  { "inputs": [], "name": "TransferFailed", "type": "error" },
  { "inputs": [], "name": "Unauthorized", "type": "error" },
  { "inputs": [], "name": "ZeroAddress", "type": "error" },
  { "inputs": [], "name": "ZeroDeposit", "type": "error" },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "client", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "ClientRefunded",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "client", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "FundsDeposited",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "freelancer", "type": "address" },
      { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "PaymentReleased",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "client",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "depositFunds",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "freelancer",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getBalance",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "refundClient",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "releasePayment",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "state",
    "outputs": [{ "internalType": "enum FreelanceMilestoneEscrow.EscrowState", "name": "", "type": "uint8" }],
    "stateMutability": "view",
    "type": "function"
  }
];

export const ESCROW_STATE_LABELS = [
  "AWAITING_PAYMENT",
  "FUNDED",
  "COMPLETED",
  "REFUNDED",
];
