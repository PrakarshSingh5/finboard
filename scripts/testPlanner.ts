import { config } from "dotenv";
config({ path: ".env.local" }); // loads GROQ_API_KEY before anything runs

import { runPlanner } from "@/agents/planner";

runPlanner("Compare Nvidia and AMD's margins")
  .then((plan) => console.log(JSON.stringify(plan, null, 2)))
  .catch((err) => console.error(err));