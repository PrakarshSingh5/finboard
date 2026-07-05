export interface ResearchPlan {
  reportType: "single-company" | "comparison" | "risk-analysis";
  companies: string[];
  metrics: string[];
  timeframe: {
    period: "quarterly" | "annual";
    range: number;
  };
}

export interface FinancialDataset {
  [ticker: string]: {
    metric: string;
    period: string;
    value: number;
    source: string;
  }[];
}

export interface DraftFinding {
  claim: string;
  supportingDataPoints: string[];
  confidence: "high" | "medium" | "low";
}

export interface CriticReview {
  status: "approved" | "revise";
  issues?: {
    findingIndex: number;
    reason: string;
  }[];
}
// Add these to src/types/agentContracts.ts (append below the existing interfaces)

export interface ChartDataPoint {
  x: string; // period label, e.g. "Q1-2027"
  y: number;
}

export interface ChartSeries {
  label: string; // e.g. "NVDA" or "NVDA - Gross Margin"
  data: ChartDataPoint[];
}

export interface ChartSpec {
  type: "line" | "bar";
  title: string;
  series: ChartSeries[];
}

export interface FinalReport {
  title: string;
  summary: string; // 2-4 sentence executive summary
  sections: {
    heading: string;
    content: string;
  }[];
  chartSpecs: ChartSpec[];
  caveats: string[]; // e.g. "Only 4 quarters of data available", "AMD Q2-2025 operating margin was negative"
}