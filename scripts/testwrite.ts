import { config } from "dotenv";
config({ path: ".env.local" }); // loads GROQ_API_KEY before anything runs


import { runPlanner } from "@/agents/planner";
import { fetchFinancialsForPlan } from "@/lib/financialApi";
import { runAnalyst } from "@/agents/analyst";
import { runWriter } from "@/agents/writer";

async function testWriter() {
  const plan = await runPlanner("Compare Nvidia and AMD's margins");
  const dataset = await fetchFinancialsForPlan(plan.companies, plan.metrics, plan.timeframe.period);
  const findings = await runAnalyst(dataset, plan);
  // Normally you'd filter findings through the Critic first — for this
  // isolated test we're passing them straight through.
  const report = await runWriter(findings, dataset, plan);
  console.log(JSON.stringify(report, null, 2));
}

testWriter().catch(console.error);
