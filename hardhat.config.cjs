require("@nomicfoundation/hardhat-toolbox");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Use the `solc` npm package already pinned in package.json (same compiler as
// scripts/compile.js) instead of downloading a compiler binary. Works offline / behind proxies.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  if (args.solcVersion === "0.8.20") {
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: "0.8.20",
      longVersion: "0.8.20",
    };
  }
  return runSuper();
});

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: { optimizer: { enabled: true, runs: 200 } },
  },
  // Keep Hardhat's output separate from scripts/compile.js, which owns ./artifacts
  paths: { artifacts: "./hh-artifacts", cache: "./hh-cache" },
};
