import { config } from "dotenv";
config({ path: ".env.local" }); // load FINANCIAL_API_KEY before anything else
    
import { runPlanner } from "@/agents/planner";
import { fetchFinancialsForPlan } from "@/lib/financialApi";
import { runAnalyst } from "@/agents/analyst";
import { runCritic } from "@/agents/critic";

async function testCritic() {
  const plan = await runPlanner("Compare Nvidia and AMD's margins");
  const dataset = await fetchFinancialsForPlan(plan.companies, plan.metrics, plan.timeframe.period);
  const findings = await runAnalyst(dataset, plan);
  const review = await runCritic(findings, dataset);
  console.log(JSON.stringify(review, null, 2));
}

testCritic().catch(console.error);