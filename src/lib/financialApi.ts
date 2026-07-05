import { FinancialDataset } from "@/types/agentContracts";

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";

// Metrics that exist directly as a field on the FMP response — just copy the value.
const DIRECT_METRIC_FIELD_MAP: Record<string, string> = {
  revenue: "revenue",
  netIncome: "netIncome",
  grossProfit: "grossProfit",
  operatingIncome: "operatingIncome",
  ebitda: "ebitda",
};

// Metrics that no longer come pre-calculated from FMP's /stable API (it dropped
// the *Ratio fields), so we derive them ourselves from two raw fields.
// Each entry is a function of the row, so the calculation logic lives in one place.
const DERIVED_METRIC_MAP: Record<string, (row: FmpIncomeStatementRow) => number | null> = {
  grossMargin: (row) =>
    row.revenue ? row.grossProfit / row.revenue : null,
  operatingMargin: (row) =>
    row.revenue ? row.operatingIncome / row.revenue : null,
};

interface FmpIncomeStatementRow {
  date: string;
  symbol: string;
  period: string; // "FY" or "Q1".."Q4"
  fiscalYear?: string; // present on /stable responses
  calendarYear?: string; // present on older/legacy responses, used as fallback
  revenue: number;
  netIncome: number;
  grossProfit: number;
  operatingIncome: number;
  ebitda: number;
  [key: string]: unknown;
}

/**
 * Fetches income statement data for a single ticker and extracts only the
 * metrics requested by the Planner Agent's ResearchPlan.
 *
 * @param ticker - e.g. "AAPL"
 * @param metrics - our internal metric names, e.g. ["revenue", "grossMargin"]
 * @param period - "quarterly" or "annual"
 * @param limit - how many historical periods to pull (e.g. 4 quarters)
 */
export async function fetchFinancials(
  ticker: string,
  metrics: string[],
  period: "quarterly" | "annual" = "quarterly",
  limit: number = 4
): Promise<FinancialDataset[string]> {
  const apiKey = process.env.FINANCIAL_API_KEY;
  if (!apiKey) {
    throw new Error("FINANCIAL_API_KEY is not set in environment variables");
  }

  const periodParam = period === "quarterly" ? "&period=quarterly" : "&period=annual";
  const url = `${FMP_BASE_URL}/income-statement?symbol=${ticker}&limit=${limit}${periodParam}&apikey=${apiKey}`;

  const response = await fetch(url);

  if (!response.ok) {
    // 403 usually means the endpoint is gated behind a paid plan;
    // 429 means you've hit the daily request cap. Surface both clearly
    // instead of letting a downstream agent silently receive empty data.
    throw new Error(
      `FMP API request failed for ${ticker}: ${response.status} ${response.statusText}`
    );
  }

  const rows = (await response.json()) as FmpIncomeStatementRow[];

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`FMP returned no income statement data for ${ticker}`);
  }

  const dataset: FinancialDataset[string] = [];

  for (const row of rows) {
    // /stable responses use `fiscalYear`; some records may still only have
    // `calendarYear` (e.g. older/legacy data), so fall back to be safe.
    const year = row.fiscalYear ?? row.calendarYear;
    const periodLabel = period === "quarterly" ? `${row.period}-${year}` : year;

    for (const metric of metrics) {
      let value: number | null = null;

      if (metric in DIRECT_METRIC_FIELD_MAP) {
        const fmpField = DIRECT_METRIC_FIELD_MAP[metric];
        const rawValue = row[fmpField];
        value = typeof rawValue === "number" ? rawValue : null;
      } else if (metric in DERIVED_METRIC_MAP) {
        value = DERIVED_METRIC_MAP[metric](row);
      } else {
        // Unknown metric requested by Planner — skip rather than crash,
        // but this is worth logging since it likely means Planner and
        // this map are out of sync.
        console.warn(`No field mapping for metric "${metric}" — skipping`);
        continue;
      }

      if (value === null) continue;

      const isDerived = metric in DERIVED_METRIC_MAP;
      const source = isDerived
        ? `FMP:income-statement:${ticker}:${row.date}:derived(${metric})`
        : `FMP:income-statement:${ticker}:${row.date}`;

      dataset.push({
        metric,
        period: periodLabel,
        value,
        source,
      });
    }
  }

  return dataset;
}

/**
 * Fetches financials for multiple tickers in parallel and assembles the
 * full FinancialDataset keyed by ticker, ready to hand to the Analyst Agent.
 */
export async function fetchFinancialsForPlan(
  tickers: string[],
  metrics: string[],
  period: "quarterly" | "annual" = "quarterly"
): Promise<FinancialDataset> {
  const results = await Promise.allSettled(
    tickers.map((ticker) => fetchFinancials(ticker, metrics, period))
  );

  const dataset: FinancialDataset = {};

  results.forEach((result, index) => {
    const ticker = tickers[index];
    if (result.status === "fulfilled") {
      dataset[ticker] = result.value;
    } else {
      // Graceful degradation (FR11 from the PRD): don't crash the whole
      // pipeline if one ticker fails — record it as empty and let the
      // Writer Agent note it as a caveat in the final report.
      console.error(`Failed to fetch financials for ${ticker}:`, result.reason);
      dataset[ticker] = [];
    }
  });

  return dataset;
}