/**
 * Yahoo Finance data provider for Indian NSE-listed companies.
 *
 * IMPORTANT: yahoo-finance2 is an unofficial, community-maintained wrapper
 * around Yahoo Finance's undocumented API. It works well for a portfolio demo
 * and has no signup or API key requirement — but it does not carry an SLA.
 * For a production system you'd want a contracted data vendor (e.g. Refinitiv,
 * IndianAPI, FinEdge) with guaranteed uptime and rate limits.
 *
 * Coverage note: large NSE-listed companies (Reliance, TCS, Infosys, HDFC, etc.)
 * are well-covered. Very recently-IPO'd or smaller companies may have thin or
 * missing fundamentals data while Yahoo's own ingestion pipeline catches up.
 *
 * API used: yahooFinance.fundamentalsTimeSeries(ticker, { module: 'financials', type: ... })
 * Returns: FundamentalsTimeSeriesFinancialsResult[] ordered newest-first.
 * Key fields (camelCase on the response object, not prefixed):
 *   totalRevenue, netIncome, grossProfit, operatingIncome, EBITDA
 */

import YahooFinance from "yahoo-finance2";
import { FinancialDataset } from "@/types/agentContracts";
import { cache, CACHE_TTL } from "@/lib/cache";

// ---------------------------------------------------------------------------
// Local type for the income-statement row returned by fundamentalsTimeSeries
// (extracted from yahoo-finance2's FundamentalsTimeSeriesFinancialsResult)
// ---------------------------------------------------------------------------
interface FinancialsRow {
  date: Date;
  TYPE: "FINANCIALS";
  periodType: string;
  totalRevenue?: number;
  netIncome?: number;
  grossProfit?: number;
  operatingIncome?: number;
  EBITDA?: number;
  [key: string]: unknown;
}


// ---------------------------------------------------------------------------
// Metric mapping: our internal names → fundamentalsTimeSeries field names
// ---------------------------------------------------------------------------

// Our internal metric name → the Yahoo field name on FinancialsRow
const METRIC_TO_YAHOO_FIELD: Record<string, keyof FinancialsRow> = {
  revenue: "totalRevenue",
  netIncome: "netIncome",
  grossProfit: "grossProfit",
  operatingIncome: "operatingIncome",
  ebitda: "EBITDA",
};

// Derived metrics computed from two raw Yahoo fields
const DERIVED_YAHOO_METRIC_MAP: Record<
  string,
  (row: FinancialsRow) => number | null
> = {
  grossMargin: (row) =>
    row.totalRevenue && row.grossProfit != null
      ? row.grossProfit / row.totalRevenue
      : null,
  operatingMargin: (row) =>
    row.totalRevenue && row.operatingIncome != null
      ? row.operatingIncome / row.totalRevenue
      : null,
};

// ---------------------------------------------------------------------------
// Defensive ticker alias map
// When Yahoo restructures or a ticker is delisted/split, map the stale ticker
// to its current replacement so we never silently return empty data.
// The Planner prompt is the authoritative source — this is a last-resort fallback.
// ---------------------------------------------------------------------------
const TICKER_ALIASES: Record<string, string> = {
  // Tata Motors demerged in 2024; TATAMOTORS.NS no longer has fundamentals on Yahoo.
  // TMPV.NS = Tata Motors Passenger Vehicles (the primary consumer-facing entity).
  "TATAMOTORS.NS": "TMPV.NS",
};


// ---------------------------------------------------------------------------
// Helper: format a period label from a Date
// ---------------------------------------------------------------------------

function formatPeriodLabel(date: Date, period: "quarterly" | "annual"): string {
  const year = date.getFullYear();
  if (period === "annual") return String(year);

  const month = date.getMonth() + 1; // 1-indexed
  const q = month <= 3 ? "Q1" : month <= 6 ? "Q2" : month <= 9 ? "Q3" : "Q4";
  return `${q}-${year}`;
}

// ---------------------------------------------------------------------------
// Core fetch function
// ---------------------------------------------------------------------------

/**
 * Fetches income statement data for a single NSE ticker via Yahoo Finance
 * and extracts the metrics requested by the Planner Agent's ResearchPlan.
 *
 * @param ticker  - must include .NS suffix, e.g. "RELIANCE.NS"
 * @param metrics - our internal metric names, e.g. ["revenue", "grossMargin"]
 * @param period  - "quarterly" or "annual"
 * @param limit   - how many historical periods to pull (e.g. 4 quarters)
 */
export async function fetchYahooFinancials(
  ticker: string,
  metrics: string[],
  period: "quarterly" | "annual" = "quarterly",
  limit: number = 4
): Promise<FinancialDataset[string]> {
  // Redirect any stale/restructured tickers to their current replacements.
  const resolvedTicker = TICKER_ALIASES[ticker.toUpperCase()] ?? ticker;
  if (resolvedTicker !== ticker) {
    console.warn(`[Yahoo] Ticker alias: ${ticker} → ${resolvedTicker}`);
  }

  const cacheKey = `yahoo:${resolvedTicker}:${[...metrics].sort().join(",")}:${period}:${limit}`;
  const cached = cache.get<FinancialDataset[string]>(cacheKey);
  if (cached) return cached;


  // Go back far enough to cover `limit` periods. 4 quarters ≈ 1 year back;
  // 4 annual periods ≈ 5 years back. We use a generous window then slice.
  const yearsBack = period === "quarterly" ? 2 : limit + 1;
  const period1 = new Date();
  period1.setFullYear(period1.getFullYear() - yearsBack);

  const yahooType = period === "quarterly" ? "quarterly" : "annual";

  let rows: FinancialsRow[];

  try {
    const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
    const result = await yf.fundamentalsTimeSeries(resolvedTicker, {
      period1: period1.toISOString().split("T")[0],
      type: yahooType,
      module: "financials",
    });

    // Filter to only FINANCIALS rows (type guard), sort newest-first, take `limit`
    rows = (result as unknown[])
      .filter(
        (r): r is FinancialsRow =>
          typeof r === "object" && r !== null && (r as FinancialsRow).TYPE === "FINANCIALS"
      )
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, limit);
  } catch (err) {
    throw new Error(
      `Yahoo Finance API request failed for ${resolvedTicker}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  if (rows.length === 0) {
    throw new Error(
      `Yahoo Finance returned no income statement data for ${resolvedTicker}. `+
        `This may be a coverage gap — try a well-established large-cap (e.g. RELIANCE.NS, TCS.NS).`
    );
  }

  const dataset: FinancialDataset[string] = [];

  for (const row of rows) {
    const periodLabel = formatPeriodLabel(row.date, period);

    for (const metric of metrics) {
      let value: number | null = null;

      if (metric in METRIC_TO_YAHOO_FIELD) {
        const field = METRIC_TO_YAHOO_FIELD[metric];
        const rawValue = row[field];
        value = typeof rawValue === "number" ? rawValue : null;
      } else if (metric in DERIVED_YAHOO_METRIC_MAP) {
        value = DERIVED_YAHOO_METRIC_MAP[metric](row);
      } else {
        console.warn(`[Yahoo] No field mapping for metric "${metric}" — skipping`);
        continue;
      }

      if (value === null) continue;

      const isDerived = metric in DERIVED_YAHOO_METRIC_MAP;
      const source = isDerived
        ? `Yahoo:income-statement:${resolvedTicker}:${periodLabel}:derived(${metric})`
        : `Yahoo:income-statement:${resolvedTicker}:${periodLabel}`;

      dataset.push({ metric, period: periodLabel, value, source });
    }
  }

  cache.set(cacheKey, dataset, CACHE_TTL.FINANCIAL_DATA);
  return dataset;
}
