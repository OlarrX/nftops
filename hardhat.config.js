require("@nomicfoundation/hardhat-toolbox");

/**
 * Minimal Hardhat config.
 * We only use Hardhat to COMPILE the Solidity templates in /contracts.
 * All deployment is handled by the CLI (src/flows/deployEvm.ts) using ethers,
 * so we deliberately keep no private keys or network RPCs in this file.
 *
 * @type import('hardhat/config').HardhatUserConfig
 */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  paths: {
    sources: "./contracts",
    artifacts: "./artifacts",
    cache: "./cache",
  },
};
