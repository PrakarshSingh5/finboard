import { config } from "dotenv";
config({ path: ".env.local" }); // load FINANCIAL_API_KEY before anything else

import { runPlanner } from "@/agents/planner";
import { fetchFinancialsForPlan } from "@/lib/financialApi";
import { runAnalyst } from "@/agents/analyst";

async function testAnalyst() {
  const plan = await runPlanner("Compare Nvidia and AMD's margins");
  const dataset = await fetchFinancialsForPlan(plan.companies, plan.metrics, plan.timeframe.period);
  const findings = await runAnalyst(dataset, plan);
  console.log(JSON.stringify(findings, null, 2));
}

testAnalyst().catch(console.error);