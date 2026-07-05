# FinBoard — AI-Powered Financial Research Assistant

> **FinBoard is not a chatbot.**
> It's an AI system that behaves like a small team of financial analysts working together to produce a professional research report — grounded entirely in real financial data.

---

## What Is FinBoard?

You type a question. FinBoard runs a 5-agent pipeline behind the scenes and hands you back a structured, fact-checked financial report — with real numbers, charts, and cited sources.

```
"Compare Nvidia and AMD's margins over the last four quarters."
```

Within ~30 seconds you get an executive summary, key metrics table, margin trend charts, risks, and caveats — all sourced from live financial APIs, not invented by an LLM.

---

## The Pipeline — How It Works

### Step 1 — 🧠 Planner Agent

The first agent doesn't answer the question. It interprets it.

It converts your natural-language query into a strict `ResearchPlan`:

```json
{
  "reportType": "comparison",
  "companies": ["NVDA", "AMD"],
  "metrics": ["grossMargin", "operatingMargin"],
  "timeframe": { "period": "quarterly", "range": 4 }
}
```

- Company names are resolved to real ticker symbols (Tesla → TSLA)
- Report type is inferred from phrasing ("compare" → `comparison`, "should I worry" → `risk-analysis`)
- Output is validated before passing downstream — if the LLM produces an invalid shape, the pipeline throws immediately rather than silently failing later

---

### Step 2 — 📡 Data Agent

The Data Agent takes the plan and fetches **real numbers** from the [Financial Modeling Prep](https://financialmodelingprep.com) `/stable` API.

It does **not** ask an LLM for financial data. Every number that enters the pipeline has a source tag:

```
FMP:income-statement:NVDA:2026-03-28
```

Metrics like `grossMargin` and `operatingMargin` — which FMP's stable API dropped as pre-calculated fields — are computed directly from raw values (`grossProfit / revenue`) rather than guessed by the model.

If a ticker fails to fetch, the pipeline degrades gracefully: the report continues with the available data and surfaces a caveat rather than crashing.

---

### Step 3 — 📊 Analyst Agent

The Analyst behaves like a junior financial analyst. It receives the dataset and produces 3–6 findings in the form of structured `DraftFindings`:

```json
{
  "claim": "NVDA gross margin declined from 73.5% in Q3-2025 to 71.0% in Q2-2026",
  "supportingDataPoints": ["NVDA.grossMargin.Q3-2025", "NVDA.grossMargin.Q2-2026"],
  "confidence": "high"
}
```

Key constraints enforced at this layer:
- Every reference ID cited must exist in the real dataset — hallucinated references are caught and rejected immediately
- The Analyst only receives reference IDs and their values, not free text, so it can't invent a number it wasn't given

---

### Step 4 — 🔍 Critic Agent *(the standout feature)*

This is what separates FinBoard from a simple chain of prompts.

The Critic reviews **each finding independently**, checking only whether the claim's stated logic (direction, comparison, magnitude) is actually supported by the numbers cited.

```
Analyst:  "NVDA gross margin increased in Q1-2026"
Data:      Q4-2025 = 73.5%,  Q1-2026 = 71.0%

Critic:   ❌ Rejected — Q1-2026 (71.0%) is lower than Q4-2025 (73.5%)
```

If a finding is rejected, it goes back to the Analyst for a **targeted revision** (only the flagged finding is re-done, not the whole report). This loop runs up to **2 rounds**. If a finding still can't be verified after retries, it is **dropped** — the pipeline ships nothing wrong over shipping everything.

```
Analyst → Critic → ❌ → Analyst (revise) → Critic → ✅ → Writer
```

---

### Step 5 — ✍️ Writer Agent

The Writer takes only the Critic-approved findings and converts them into a polished, readable report:

```
Tesla Q2 Risk Analysis
─────────────────────
Executive Summary
Revenue grew modestly while net income declined sharply, driven by margin
compression and elevated operating expenses. Cash reserves improved.

Key Findings
• Net income fell 18% quarter-over-quarter despite a 12% revenue increase
• Gross margin compressed from 19.3% to 17.8%
• ...

Risks
• Margin compression trend across 3 consecutive quarters
• ...

Caveats
• Report covers the last 4 quarterly periods only
• 1 finding was excluded after failing verification
```

Charts are built **deterministically from the raw dataset** — the LLM is never asked to produce chart data, eliminating an entire class of hallucination risk.

---

## Architecture

```
src/
├── agents/
│   ├── planner.ts       # Natural language → ResearchPlan
│   ├── analyst.ts       # Dataset → DraftFindings + reviseFinding()
│   ├── critic.ts        # Per-finding fact-check with retry loop
│   └── writer.ts        # Approved findings → FinalReport (+ chart specs)
├── lib/
│   └── financialApi.ts  # FMP /stable wrapper (fetchFinancials, fetchFinancialsForPlan)
├── orchestrator/
│   └── pipeline.ts      # End-to-end orchestration with SSE event callbacks
├── types/
│   └── agentContracts.ts # Shared types: ResearchPlan, FinancialDataset, DraftFinding, etc.
└── app/                 # Next.js frontend (dashboard + report renderer)

scripts/                 # Standalone test scripts for each agent layer
├── testPlanner.ts
├── testFetchFinancials.ts
├── testanalyst.ts
├── testcretics.ts
├── testwrite.ts
└── testcompletepipline.ts
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router) |
| Language | TypeScript (strict mode) |
| LLM Provider | [Groq](https://groq.com) — `llama-3.1-8b-instant` |
| Financial Data | [Financial Modeling Prep](https://financialmodelingprep.com) `/stable` API |
| Charts | [Recharts](https://recharts.org) |
| Database | PostgreSQL via [Neon](https://neon.tech) / [Supabase](https://supabase.com) |
| Streaming | Server-Sent Events (SSE) for live agent activity feed |

---

## Getting Started

### 1. Clone & install

```bash
git clone https://github.com/PrakarshSingh5/finboard.git
cd finboard
npm install
```

### 2. Set up environment variables

Create a `.env.local` file in the project root:

```env
GROQ_API_KEY=gsk_your_groq_key_here
FINANCIAL_API_KEY=your_fmp_key_here
DATABASE_URL=your_postgres_connection_string
```

- **Groq API key** → [console.groq.com/keys](https://console.groq.com/keys)
- **FMP API key** → [financialmodelingprep.com](https://financialmodelingprep.com/developer/docs)
- Ensure `llama-3.1-8b-instant` is enabled in your Groq project: [console.groq.com/settings/project/limits](https://console.groq.com/settings/project/limits)

### 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Testing Each Agent Layer

Each agent can be tested independently without running the full UI:

```bash
# Test the Planner Agent
npx tsx --tsconfig tsconfig.json scripts/testPlanner.ts

# Test the Data Agent (FMP fetch)
npx tsx --tsconfig tsconfig.json scripts/testFetchFinancials.ts

# Test the Analyst Agent
npx tsx --tsconfig tsconfig.json scripts/testanalyst.ts

# Test the Critic Agent
npx tsx --tsconfig tsconfig.json scripts/testcretics.ts

# Test the Writer Agent
npx tsx --tsconfig tsconfig.json scripts/testwrite.ts

# Run the full pipeline end-to-end
npx tsx --tsconfig tsconfig.json scripts/testcompletepipline.ts
```

---

## Why Not Just Use ChatGPT?

| | ChatGPT / Copilot | FinBoard |
|---|---|---|
| Data source | LLM training data (may be stale) | Live financial APIs |
| Numbers | Generated / approximated | Real, sourced, cited |
| Fact-checking | None | Critic Agent reviews every claim |
| Output | Free-form text | Structured report with charts |
| Transparency | Black box | Every number has a source tag |

---

## What Makes This Technically Interesting

- **Multi-agent orchestration** — five independent agents with typed contracts between them, not a monolithic prompt
- **Self-correcting pipeline** — the Critic ↔ Analyst retry loop catches factual errors before they reach the user
- **Grounded generation** — the LLM is never asked to produce a number; it only interprets numbers that came from a verified source
- **Graceful degradation** — if one ticker fails, one finding is wrong, or retries are exhausted, the pipeline continues with what it has and is transparent about what was dropped
- **SSE streaming** — the frontend can display a live activity feed showing each agent's progress in real time

---

## License

MIT
