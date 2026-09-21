import fs from "fs";
import path from "path";
import "dotenv/config";
import { JsonRpcProvider, Wallet, ContractFactory } from "ethers";

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FREELANCER_ADDRESS = process.env.FREELANCER_ADDRESS;

if (!PRIVATE_KEY) {
  console.error("Missing PRIVATE_KEY in .env (the client/deployer's private key).");
  process.exit(1);
}
if (!FREELANCER_ADDRESS) {
  console.error("Missing FREELANCER_ADDRESS in .env (the freelancer's wallet address).");
  process.exit(1);
}

const artifactPath = path.resolve("artifacts", "FreelanceMilestoneEscrow.json");
if (!fs.existsSync(artifactPath)) {
  console.error(`No compiled artifact at ${artifactPath}. Run "npm run compile" first.`);
  process.exit(1);
}
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

async function main() {
  const provider = new JsonRpcProvider(RPC_URL);
  const deployer = new Wallet(PRIVATE_KEY, provider);

  console.log(`Deploying FreelanceMilestoneEscrow`);
  console.log(`  RPC:        ${RPC_URL}`);
  console.log(`  Client:     ${deployer.address}`);
  console.log(`  Freelancer: ${FREELANCER_ADDRESS}`);

  const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy(FREELANCER_ADDRESS);
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`\nDeployed at: ${address}`);
  console.log(`\nSet this in frontend/.env:`);
  console.log(`VITE_CONTRACT_ADDRESS=${address}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
