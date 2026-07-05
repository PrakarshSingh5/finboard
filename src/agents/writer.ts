
import {
  FinancialDataset,
  DraftFinding,
  ResearchPlan,
  FinalReport,
  ChartSpec,
} from "@/types/agentContracts";

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

interface GroqChatResponse {
  choices: { message: { content: string } }[];
}

/**
 * Builds chart specs directly from the FinancialDataset — one chart per
 * metric requested in the plan, with one series per company. This never
 * touches the LLM; it's a straight data transformation, so there's zero
 * risk of a chart displaying a number the LLM invented.
 */
function buildChartSpecs(dataset: FinancialDataset, plan: ResearchPlan): ChartSpec[] {
  return plan.metrics.map((metric) => {
    const series = plan.companies.map((ticker) => {
      const points = (dataset[ticker] ?? [])
        .filter((p) => p.metric === metric)
        // Chronological order matters for a readable line chart — the API
        // returns most-recent-first, so reverse it here.
        .slice()
        .reverse();

      return {
        label: ticker,
        data: points.map((p) => ({ x: p.period, y: p.value })),
      };
    });

    return {
      type: "line" as const,
      title: formatMetricTitle(metric),
      series,
    };
  });
}

/** Converts an internal metric key like "grossMargin" into a display title. */
function formatMetricTitle(metric: string): string {
  const titles: Record<string, string> = {
    revenue: "Revenue",
    netIncome: "Net Income",
    grossProfit: "Gross Profit",
    grossMargin: "Gross Margin",
    operatingIncome: "Operating Income",
    operatingMargin: "Operating Margin",
    ebitda: "EBITDA",
  };
  return titles[metric] ?? metric;
}

/**
 * Builds the caveats list. Some caveats are structural facts we already
 * know (no LLM needed) — e.g. limited data window, or a company that
 * failed to fetch. These are added directly, not left to the LLM to
 * remember to mention.
 */
function buildStructuralCaveats(dataset: FinancialDataset, plan: ResearchPlan): string[] {
  const caveats: string[] = [];

  for (const ticker of plan.companies) {
    const points = dataset[ticker] ?? [];
    if (points.length === 0) {
      caveats.push(`No data could be retrieved for ${ticker}; it is excluded from this report.`);
    }
  }

  caveats.push(
    `This report covers only the last ${plan.timeframe.range} ${plan.timeframe.period} periods available and should not be treated as investment advice.`
  );

  return caveats;
}

/**
 * Runs the Writer Agent.
 *
 * @param approvedFindings - findings that passed the Critic Agent (revise the pipeline should filter these before calling Writer)
 * @param dataset - the original FinancialDataset, used for chart data (not for the LLM prompt's numeric claims)
 * @param plan - the original ResearchPlan
 */
export async function runWriter(
  approvedFindings: DraftFinding[],
  dataset: FinancialDataset,
  plan: ResearchPlan
): Promise<FinalReport> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not set in environment variables");
  }

  // Chart specs and structural caveats are built without any LLM call.
  const chartSpecs = buildChartSpecs(dataset, plan);
  const structuralCaveats = buildStructuralCaveats(dataset, plan);

  const findingsList = approvedFindings
    .map((f, i) => `${i + 1}. ${f.claim} (confidence: ${f.confidence})`)
    .join("\n");

  const systemPrompt = `You are the Writer Agent in a financial research pipeline.
You will be given a list of pre-verified findings (already fact-checked against real data — do not question or alter their substance, only their phrasing/organization).

Your job: write a polished report using ONLY the findings given. Do not add any new facts, numbers, or claims not present in the findings list.

Respond with ONLY a JSON object of this exact shape:
{
  "title": "short report title",
  "summary": "2-4 sentence executive summary synthesizing the findings",
  "sections": [
    { "heading": "string", "content": "1-2 paragraphs, grounded only in the given findings" }
  ]
}

Guidance:
- Report type is "${plan.reportType}".
- Organize sections logically (e.g. for a comparison report: one section per key theme, not one section per company).
- Do not invent transition claims or numbers beyond what's in the findings list.
- Keep tone neutral and analytical, not promotional.`;

  const userMessage = `Findings:\n${findingsList}\n\nCompanies: ${plan.companies.join(", ")}`;

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.4, // a bit more room for natural prose phrasing than the Analyst/Critic
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Writer Agent: Groq API request failed: ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as GroqChatResponse;
  const rawContent = data.choices[0]?.message?.content;
  if (!rawContent) {
    throw new Error("Writer Agent: Groq response contained no content");
  }

  let parsed: { title?: string; summary?: string; sections?: { heading: string; content: string }[] };
  try {
    parsed = JSON.parse(rawContent);
  } catch {
    throw new Error(`Writer Agent: failed to parse LLM output as JSON. Raw output: ${rawContent}`);
  }

  if (!parsed.title || !parsed.summary || !Array.isArray(parsed.sections)) {
    throw new Error("Writer Agent: LLM output missing required fields (title/summary/sections)");
  }

  return {
    title: parsed.title,
    summary: parsed.summary,
    sections: parsed.sections,
    chartSpecs,
    caveats: structuralCaveats,
  };
}