// src/app/page.tsx

"use client";

import { useReportPipeline } from "@/hooks/useReportPipeline";
import { QueryInput } from "@/components/QueryInput";
import { AgentActivityFeed } from "@/components/AgentActivityFeed";
import { ReportView } from "@/components/ReportView";

export default function HomePage() {
  const { events, report, status, errorMessage, runQuery } = useReportPipeline();

  const isStreaming = status === "streaming";

  return (
    <main className="max-w-3xl mx-auto px-6 py-20 space-y-10">
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-signal" />
          <span className="font-mono text-[11px] uppercase tracking-widest text-ink-faint">
            AI Research Terminal
          </span>
        </div>
        <h1 className="font-display text-3xl font-semibold text-ink">FinBoard</h1>
        <p className="font-body text-ink-muted text-sm">
          Ask a financial question. A team of AI agents will research it for you.
        </p>
      </div>

      <QueryInput onSubmit={runQuery} disabled={isStreaming} />

      {isStreaming && <AgentActivityFeed events={events} isStreaming />}

      {status === "out-of-scope" && (
        <div className="rounded-lg border border-signal-dim bg-signal/10 p-4 font-mono text-sm text-signal">
          {errorMessage}
        </div>
      )}

      {status === "error" && (
        <div className="rounded-lg border border-loss/40 bg-loss/10 p-4 font-mono text-sm text-loss">
          {errorMessage}
        </div>
      )}

      {status === "done" && report && (
        <>
          <AgentActivityFeed events={events} />
          <ReportView report={report} />
        </>
      )}
    </main>
  );
}