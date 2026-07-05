import { FinancialDataset, DraftFinding, ResearchPlan } from "@/types/agentContracts";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

function buildReferenceIndex(dataset: FinancialDataset): Record<string, number> {
  const index: Record<string, number> = {};

  for (const [ticker, points] of Object.entries(dataset)) {
    for (const point of points) {
      const refId = `${ticker}.${point.metric}.${point.period}`;
      index[refId] = point.value;
    }
  }

  return index;
}


function formatDataForPrompt(index: Record<string, number>): string {
  return Object.entries(index)
    .map(([refId, value]) => `${refId} = ${value}`)
    .join("\n");
}

interface GroqChatResponse {
  choices: {
    message: {
      content: string;
    };
  }[];
}

/**
 * Runs the Analyst Agent.
 *
 * @param dataset - normalized financial data from the Data Agent
 * @param plan - the original ResearchPlan, so the Analyst knows the report's intent
 * @returns a list of DraftFindings, each citing exact reference ids from the dataset
 */
export async function runAnalyst(
  dataset: FinancialDataset,
  plan: ResearchPlan
): Promise<DraftFinding[]> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in environment variables");
  }

  const referenceIndex = buildReferenceIndex(dataset);
  const dataTable = formatDataForPrompt(referenceIndex);
  const validRefIds = Object.keys(referenceIndex);

  const systemPrompt = `You are the Analyst Agent in a financial research pipeline.
You will be given a report type and a table of financial data points, each with a unique reference id in the form "TICKER.metric.period".

Your job: produce 3-6 findings (insights, trends, comparisons, or anomalies) based ONLY on the data given.

Respond with ONLY a JSON object of this exact shape, no other text:
{
  "findings": [
    {
      "claim": "string describing the insight in plain English",
      "supportingDataPoints": ["exact reference ids from the table that support this claim"],
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Critical rules:
- Every reference id in "supportingDataPoints" MUST be copied EXACTLY as it appears in the data table. Do not invent or modify reference ids.
- Every claim must be directly supported by the reference ids you cite — do not state a number or trend that isn't visible in the data table.
- If you notice something unusual (e.g. a negative margin, a sudden drop), it's fine to flag it as a finding with appropriate confidence.
- Use "low" confidence if the data only weakly supports the claim (e.g. based on just one data point) or if you are inferring rather than directly observing.
- Report type is "${plan.reportType}" — for a comparison report, prioritize findings that directly compare the companies involved.`;

  const userMessage = `Data table:\n${dataTable}\n\nCompanies: ${plan.companies.join(", ")}\nMetrics of interest: ${plan.metrics.join(", ")}`;

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      response_format: { type: "json_object" },
      // Slightly higher than the Planner's 0.1 — this task benefits from a
      // little more flexibility to notice/phrase varied insights, but still
      // low enough to stay grounded and not get creative with numbers.
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
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
    throw new Error("Analyst Agent: Groq response contained no content");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(
      `Analyst Agent: failed to parse LLM output as JSON. Raw output: ${rawContent}`
    );
  }

  return validateFindings(parsed, validRefIds);
}

/**
 * Validates the parsed findings: correct shape, AND every cited reference id
 * actually exists in the dataset. This second check is what prevents a
 * hallucinated reference (an id that looks plausible but was never in the
 * data table) from silently passing through as "supported."
 */
function validateFindings(data: unknown, validRefIds: string[]): DraftFinding[] {
  if (
    typeof data !== "object" ||
    data === null ||
    !Array.isArray((data as { findings?: unknown }).findings)
  ) {
    throw new Error("Analyst Agent: response did not contain a findings array");
  }

  const findings = (data as { findings: unknown[] }).findings;
  const validRefIdSet = new Set(validRefIds);

  return findings.map((raw, i) => {
    const f = raw as Partial<DraftFinding>;

    if (typeof f.claim !== "string" || !f.claim.trim()) {
      throw new Error(`Analyst Agent: finding at index ${i} is missing a claim`);
    }

    if (!Array.isArray(f.supportingDataPoints) || f.supportingDataPoints.length === 0) {
      throw new Error(
        `Analyst Agent: finding at index ${i} ("${f.claim}") has no supportingDataPoints`
      );
    }

    // This is the hallucination check: every cited ref id must exist in the
    // real dataset. If the LLM invented one, we catch it here rather than
    // passing a fabricated citation down to the Critic/Writer.
    const invalidRefs = f.supportingDataPoints.filter((ref) => !validRefIdSet.has(ref));
    if (invalidRefs.length > 0) {
      throw new Error(
        `Analyst Agent: finding at index ${i} ("${f.claim}") cites unknown reference ids: ${invalidRefs.join(", ")}`
      );
    }

    const validConfidence = ["high", "medium", "low"];
    const confidence = validConfidence.includes(f.confidence as string)
      ? (f.confidence as DraftFinding["confidence"])
      : "medium"; // default fallback rather than hard failure on this field alone

    return {
      claim: f.claim,
      supportingDataPoints: f.supportingDataPoints,
      confidence,
    };
  });
}

/**
 * Asks the Analyst to fix ONE specific finding that the Critic rejected,
 * given the Critic's exact reason. This is narrower and cheaper than
 * re-running the whole Analyst from scratch — only the flagged finding
 * gets redone, everything else the Analyst already got right is untouched.
 *
 * @param originalFinding - the finding the Critic rejected
 * @param criticReason - the Critic's specific explanation of what's wrong
 * @param dataset - needed to rebuild the reference index for validation
 * @returns a corrected DraftFinding, still validated against the real dataset
 */
export async function reviseFinding(
  originalFinding: DraftFinding,
  criticReason: string,
  dataset: FinancialDataset
): Promise<DraftFinding> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in environment variables");
  }
 
  const referenceIndex = buildReferenceIndex(dataset);
  const validRefIds = Object.keys(referenceIndex);
 
  // Only show the values this finding actually cited, plus the critique —
  // same "narrow context" principle used in the Critic Agent. The model
  // should fix the specific problem, not go rewrite something unrelated.
  const citedValues = originalFinding.supportingDataPoints
    .filter((ref) => ref in referenceIndex)
    .map((ref) => `${ref} = ${referenceIndex[ref]}`);
 
  const systemPrompt = `You are the Analyst Agent, revising one finding that a Critic Agent rejected.
 
Original claim: "${originalFinding.claim}"
Critic's reason for rejection: "${criticReason}"
Cited data values:
${citedValues.join("\n")}
 
Produce a corrected finding that fixes the specific problem identified. You may reuse the same reference ids if they're still relevant, or adjust supportingDataPoints if needed — but only from the values shown above.
 
Respond with ONLY a JSON object of this exact shape:
{
  "claim": "corrected claim text",
  "supportingDataPoints": ["reference ids from the values shown above"],
  "confidence": "high" | "medium" | "low"
}`;
 
  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.1, // low — this is a correction task, not a creative one
      messages: [{ role: "system", content: systemPrompt }],
    }),
  });
 
  if (!response.ok) {
    throw new Error(
      `Analyst Agent (revision): Groq API request failed: ${response.status} ${response.statusText}`
    );
  }
 
  const data = (await response.json()) as GroqChatResponse;
  const rawContent = data.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error("Analyst Agent (revision): Groq response contained no content");
  }
 
  const parsed = JSON.parse(rawContent);
  const validated = validateFindings({ findings: [parsed] }, validRefIds);
  return validated[0];
}