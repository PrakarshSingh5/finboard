// scripts/testFetchFinancials.ts
// Temporary sanity-check script — safe to delete after testing.
// Run with: npx tsx --tsconfig tsconfig.json scripts/testFetchFinancials.ts

import { config } from "dotenv";
config({ path: ".env.local" }); // load FINANCIAL_API_KEY before anything else

import { fetchFinancials } from "@/lib/financialApi";

(async () => {
  console.log("⏳ Fetching AAPL quarterly financials (revenue + grossMargin, last 4 quarters)...\n");

  const data = await fetchFinancials("AAPL", ["revenue", "grossMargin"], "quarterly", 4);
  console.log(JSON.stringify(data, null, 2));
  console.log(`\n✅ Fetched ${data.length} data point(s).`);
})().catch((err) => {
  console.error("❌ Error:", err.message ?? err);
  process.exit(1);
});
