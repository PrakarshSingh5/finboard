import { ResearchPlan } from "@/types/agentContracts";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";

// The system prompt is where we teach the LLM the exact shape we need back.
// We ask for JSON-only output (no explanation, no markdown fences) because
// we're going to JSON.parse() this directly — any extra text breaks parsing.
const SYSTEM_PROMPT = `You are the Planner Agent in a financial research pipeline.
Your ONLY job is to convert a user's question into a JSON object matching this exact shape:

{
  "reportType": "single-company" | "comparison" | "risk-analysis",
  "companies": string[],   // stock ticker symbols, e.g. ["AAPL"], NOT company names
  "metrics": string[],     // choose only from: "revenue", "netIncome", "grossProfit", "grossMargin", "operatingIncome", "operatingMargin", "ebitda"
  "timeframe": {
    "period": "quarterly" | "annual",
    "range": number        // how many periods back, e.g. 4 for last 4 quarters
  }
}

Rules:
- Always convert company names to their real stock ticker symbol (Tesla -> TSLA, Apple -> AAPL, Nvidia -> NVDA, etc).
- If the user mentions two or more companies, or uses words like "compare" or "vs", use reportType "comparison".
- If the user asks about risk, concerns, red flags, or "should I be worried", use reportType "risk-analysis" and include metrics relevant to financial health (e.g. netIncome, operatingMargin).
- If unsure about timeframe, default to { "period": "quarterly", "range": 4 }.
- Only pick metrics from the allowed list above — never invent a new metric name.
- Respond with ONLY the JSON object. No explanation, no markdown code fences, no extra text.`;

interface GroqChatResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

/**
 * Runs the Planner Agent: converts a user's natural-language financial
 * question into a structured, typed ResearchPlan.
 *
 * @param userQuery - the raw question the user typed, e.g. "Compare Nvidia and AMD's margins"
 * @returns a validated ResearchPlan ready to hand to the Data Agent
 */
export async function runPlanner(userQuery: string): Promise<ResearchPlan> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in environment variables");
  }

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      // Groq's JSON mode forces the model to return valid JSON —
      // this is a big reliability upgrade over just asking nicely in the prompt.
      response_format: { type: "json_object" },
      temperature: 0.1, // low temperature: we want consistent, boring, correct output here, not creativity
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userQuery },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Groq API request failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as GroqChatResponse;
  const rawContent = data.choices[0]?.message?.content;

  if (!rawContent) {
    throw new Error("Planner Agent: Groq response contained no content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(
      `Planner Agent: failed to parse LLM output as JSON. Raw output: ${rawContent}`
    );
  }


  const plan = validateResearchPlan(parsed);
  return plan;
}

/**
 * Validates that an unknown parsed object actually matches the ResearchPlan
 * shape before we trust it. Throws a descriptive error if not.
 *
 * This is a lightweight hand-written check. If the project grows, swapping
 * this for a `zod` schema (`ResearchPlanSchema.parse(parsed)`) would give the
 * same safety with less code — worth mentioning as a "next step" in an interview.
 */
function validateResearchPlan(data: unknown): ResearchPlan {
  if (typeof data !== "object" || data === null) {
    throw new Error("Planner Agent: LLM output is not an object");
  }

  const candidate = data as Partial<ResearchPlan>;

  const validReportTypes = ["single-company", "comparison", "risk-analysis"];
  if (!candidate.reportType || !validReportTypes.includes(candidate.reportType)) {
    throw new Error(`Planner Agent: invalid or missing reportType: ${candidate.reportType}`);
  }

  if (!Array.isArray(candidate.companies) || candidate.companies.length === 0) {
    throw new Error("Planner Agent: companies must be a non-empty array");
  }

  if (!Array.isArray(candidate.metrics) || candidate.metrics.length === 0) {
    throw new Error("Planner Agent: metrics must be a non-empty array");
  }

  if (
    !candidate.timeframe ||
    typeof candidate.timeframe.range !== "number" ||
    !["quarterly", "annual"].includes(candidate.timeframe.period)
  ) {
    throw new Error("Planner Agent: invalid or missing timeframe");
  }

  // Normalize tickers to uppercase — the LLM usually gets this right, but
  // defensive normalization here avoids a whole class of "AAPL" vs "aapl"
  // bugs when this gets used as a key later in FinancialDataset.
  return {
    reportType: candidate.reportType as ResearchPlan["reportType"],
    companies: candidate.companies.map((c) => String(c).toUpperCase()),
    metrics: candidate.metrics as string[],
    timeframe: candidate.timeframe as ResearchPlan["timeframe"],
  };
}