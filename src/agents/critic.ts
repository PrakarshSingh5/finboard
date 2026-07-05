// src/agents/critic.ts
//
// Critic Agent — the self-correction step. Takes the Analyst's DraftFindings
// and checks each one against the REAL underlying values (not just checking
// that the reference ids exist — the Analyst's own validation already
// guarantees that). The Critic's job is semantic: does the claim's actual
// numeric logic hold given the values it cites?
//
// Key design choice: for each finding, we pull out ONLY the values it cited
// and hand those (not the whole data table) back to the LLM for review.
// This is a narrower, more falsifiable check than "does this report look
// right overall" — the model has no room to get distracted by other data.

import { FinancialDataset, DraftFinding, CriticReview } from "@/types/agentContracts";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const MAX_REVISION_ROUNDS = 2;

/**
 * Rebuilds the same ticker.metric.period -> value index the Analyst used.
 * Kept as a standalone function (not imported from analyst.ts) so the
 * Critic Agent has no dependency on the Analyst's internals — it only
 * depends on the shared FinancialDataset type. Agents should be swappable
 * without needing to know each other's implementation details.
 */
function buildReferenceIndex(dataset: FinancialDataset): Record<string, number> {
  const index: Record<string, number> = {};
  for (const [ticker, points] of Object.entries(dataset)) {
    for (const point of points) {
      index[`${ticker}.${point.metric}.${point.period}`] = point.value;
    }
  }
  return index;
}

interface GroqChatResponse {
  choices: { message: { content: string } }[];
}

/**
 * Runs the Critic Agent against a single finding.
 * Returns whether it's approved, and if not, why.
 */
async function critiqueFinding(
  finding: DraftFinding,
  referenceIndex: Record<string, number>,
  apiKey: string
): Promise<{ approved: boolean; reason?: string }> {
  // Pull out ONLY the values this specific finding cited. This is the
  // "narrow verification" — the model reviews the claim against exactly
  // the evidence it used, nothing more, nothing less.
  const citedValues = finding.supportingDataPoints.map(
    (refId) => `${refId} = ${referenceIndex[refId]}`
  );

  const systemPrompt = `You are the Critic Agent in a financial research pipeline.
You will be given ONE claim and the exact data values that were cited as support for it.

Check ONLY these things:
1. Does the claim's stated direction/comparison (e.g. "higher than", "declined", "increased") actually match what the numbers show?
2. Is the claim overstating certainty the numbers don't support (e.g. calling a single data point a "trend")?
3. Is the claim's wording misleading given the actual magnitude of the numbers?

Do NOT invent alternative interpretations or introduce outside knowledge — judge only whether the claim logically follows from the cited numbers.

Respond with ONLY a JSON object of this exact shape:
{ "approved": true } 
or
{ "approved": false, "reason": "short explanation of the specific logical or numeric problem" }`;

  const userMessage = `Claim: "${finding.claim}"\nConfidence stated: ${finding.confidence}\n\nCited values:\n${citedValues.join("\n")}`;

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      response_format: { type: "json_object" },
      temperature: 0, // deterministic — this is a verification task, not a creative one
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Critic Agent: Groq API request failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as GroqChatResponse;
  const rawContent = data.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error("Critic Agent: Groq response contained no content");
  }

  const parsed = JSON.parse(rawContent) as { approved: boolean; reason?: string };
  return parsed;
}

/**
 * Runs the Critic Agent across all findings from the Analyst.
 *
 * @param findings - the Analyst's draft findings
 * @param dataset - the original FinancialDataset, needed to resolve reference ids to values
 * @returns a CriticReview: approved (nothing wrong) or revise (with specific issues per finding index)
 */
export async function runCritic(
  findings: DraftFinding[],
  dataset: FinancialDataset
): Promise<CriticReview> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in environment variables");
  }

  const referenceIndex = buildReferenceIndex(dataset);

  // Defense in depth: even though the Analyst already validated that every
  // cited ref id exists, we re-check here too. Agents shouldn't trust that
  // upstream validation was correctly wired — cheap to re-verify, expensive
  // to silently ship a broken report.
  const issues: { findingIndex: number; reason: string }[] = [];

  for (let i = 0; i < findings.length; i++) {
    const finding = findings[i];

    const missingRefs = finding.supportingDataPoints.filter(
      (ref) => !(ref in referenceIndex)
    );
    if (missingRefs.length > 0) {
      issues.push({
        findingIndex: i,
        reason: `Cites unknown reference id(s): ${missingRefs.join(", ")}`,
      });
      continue; // no point running the LLM check on unresolvable data
    }

    const result = await critiqueFinding(finding, referenceIndex, apiKey);
    if (!result.approved) {
      issues.push({
        findingIndex: i,
        reason: result.reason ?? "Critic flagged this claim without a specific reason",
      });
    }
  }

  return issues.length === 0 ? { status: "approved" } : { status: "revise", issues };
}

export { MAX_REVISION_ROUNDS };