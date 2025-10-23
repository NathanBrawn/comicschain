import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, resolve } from "path";

const CONTRACT = "MiniComicRegistry";
const HARDHAT_DIR = resolve("../mini-comic-hardhat");
const DEPLOYMENTS_DIR = join(HARDHAT_DIR, "deployments");
const OUTDIR = resolve("./abi");

if (!existsSync(OUTDIR)) mkdirSync(OUTDIR);

function readDeployment(chainName) {
  const p = join(DEPLOYMENTS_DIR, chainName, `${CONTRACT}.json`);
  try {
    const raw = readFileSync(p, "utf-8");
    const j = JSON.parse(raw);
    return j;
  } catch {
    return null;
  }
}

const sepolia = readDeployment("sepolia");
const localhost = readDeployment("localhost");

if (!sepolia && !localhost) {
  console.error("No deployments found. Please deploy first.");
  process.exit(1);
}

const abi = (sepolia || localhost).abi;
const addresses = {
  "11155111": {
    address: sepolia ? sepolia.address : "0x0000000000000000000000000000000000000000",
    chainId: 11155111,
    chainName: "sepolia",
  },
  "31337": {
    address: localhost ? localhost.address : "0x0000000000000000000000000000000000000000",
    chainId: 31337,
    chainName: "hardhat",
  },
};

const abiTs = `export const ${CONTRACT}ABI = ${JSON.stringify({ abi }, null, 2)} as const;\n`;
const addrTs = `export const ${CONTRACT}Addresses = ${JSON.stringify(addresses, null, 2)} as const;\n`;

writeFileSync(join(OUTDIR, `${CONTRACT}ABI.ts`), abiTs);
writeFileSync(join(OUTDIR, `${CONTRACT}Addresses.ts`), addrTs);
console.log("ABI and addresses generated.");




