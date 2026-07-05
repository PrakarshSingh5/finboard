// src/components/ReportView.tsx
//
// Renders the FinalReport as a "research memo": a ticker eyebrow, a serif-
// weight display title, hairline dividers between sections, and caveats
// styled as a small print footer. Every text color here is explicitly
// chosen for the dark theme (ink / ink-muted / ink-faint) — no default
// grays that assume a light background.

import type { FinalReport, ResearchPlan } from "@/types/agentContracts";
import { MetricChart } from "./charts/MetricChart";

interface ReportViewProps {
  report: FinalReport;
  companies?: ResearchPlan["companies"];
}

export function ReportView({ report, companies }: ReportViewProps) {
  return (
    <article className="w-full rounded-lg border border-hairline bg-surface p-8 space-y-8">
      <header className="space-y-3">
        {companies && companies.length > 0 && (
          <div className="flex gap-2">
            {companies.map((ticker) => (
              <span
                key={ticker}
                className="font-mono text-xs font-semibold text-signal border border-signal-dim rounded px-2 py-0.5"
              >
                {ticker}
              </span>
            ))}
          </div>
        )}
        <h2 className="font-display text-2xl font-semibold text-ink leading-snug">
          {report.title}
        </h2>
        <p className="font-body text-ink-muted leading-relaxed">{report.summary}</p>
      </header>

      {report.chartSpecs.length > 0 && (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t border-hairline pt-8">
          {report.chartSpecs.map((spec) => (
            <MetricChart key={spec.title} spec={spec} />
          ))}
        </section>
      )}

      <section className="space-y-6 border-t border-hairline pt-8">
        {report.sections.map((section) => (
          <div key={section.heading}>
            <h3 className="font-display text-sm font-semibold uppercase tracking-wide text-ink-muted mb-2">
              {section.heading}
            </h3>
            <p className="font-body text-ink leading-relaxed">{section.content}</p>
          </div>
        ))}
      </section>

      {report.caveats.length > 0 && (
        <footer className="border-t border-hairline pt-5">
          <h4 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-ink-faint mb-2">
            Caveats
          </h4>
          <ul className="space-y-1">
            {report.caveats.map((caveat, i) => (
              <li key={i} className="font-mono text-xs text-ink-faint leading-relaxed">
                — {caveat}
              </li>
            ))}
          </ul>
        </footer>
      )}
    </article>
  );
}