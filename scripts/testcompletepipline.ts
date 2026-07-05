import { config } from "dotenv";
config({ path: ".env.local" }); // load FINANCIAL_API_KEY before anything else
    
import { runPipeline } from "@/orchestrator/pipeline";

async function testPipeline() {
  const report = await runPipeline("Compare Nvidia and AMD's margins", (event) => {
    console.log(`[${event.agent}] ${event.message}`);
  });
  console.log("\n=== FINAL REPORT ===");
  console.log(JSON.stringify(report, null, 2));
}

testPipeline().catch(console.error);