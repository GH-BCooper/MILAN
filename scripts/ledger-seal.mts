import { config } from "dotenv";
config({ path: ".env.local" });
const { sealLegacyPayloads } = await import("@/lib/ledger/seal");
const { verifyChain } = await import("@/lib/ledger/verify");
console.log(await sealLegacyPayloads());
console.log(await verifyChain());
process.exit(0);
