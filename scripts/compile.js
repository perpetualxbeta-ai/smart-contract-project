import fs from "fs";
import path from "path";
import solc from "solc";

const CONTRACT_NAME = "FreelanceMilestoneEscrow";
const contractPath = path.resolve("contracts", `${CONTRACT_NAME}.sol`);
const source = fs.readFileSync(contractPath, "utf8");

const input = {
  language: "Solidity",
  sources: {
    [`${CONTRACT_NAME}.sol`]: { content: source },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

let hasError = false;
if (output.errors) {
  for (const err of output.errors) {
    const stream = err.severity === "error" ? console.error : console.warn;
    stream(err.formattedMessage);
    if (err.severity === "error") hasError = true;
  }
}

if (hasError || !output.contracts) {
  console.error("Compilation failed.");
  process.exit(1);
}

const contract = output.contracts[`${CONTRACT_NAME}.sol`][CONTRACT_NAME];

fs.mkdirSync("artifacts", { recursive: true });
const artifact = {
  contractName: CONTRACT_NAME,
  abi: contract.abi,
  bytecode: "0x" + contract.evm.bytecode.object,
  deployedBytecode: "0x" + contract.evm.deployedBytecode.object,
};
fs.writeFileSync(
  path.join("artifacts", `${CONTRACT_NAME}.json`),
  JSON.stringify(artifact, null, 2)
);

console.log(`Compiled successfully with solc ${solc.version()}`);
console.log(`ABI + bytecode written to artifacts/${CONTRACT_NAME}.json`);
