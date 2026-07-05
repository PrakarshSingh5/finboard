import { config } from "dotenv";
config({ path: ".env.local" }); // loads GROQ_API_KEY before anything runs

import { runPlanner } from "@/agents/planner";
import { fetchFinancialsForPlan } from "@/lib/financialApi";

async function testPipeline() {
  const plan = await runPlanner("Compare Nvidia and AMD's margins");
  console.log("Plan:", plan);

  const dataset = await fetchFinancialsForPlan(
    plan.companies,
    plan.metrics,
    plan.timeframe.period
  );
  console.log("Dataset:", JSON.stringify(dataset, null, 2));
}

testPipeline().catch(console.error);