// src/orchestrator/pipeline.ts
//
// The orchestrator. This is the piece that actually runs the multi-agent
// system end to end: Planner -> Data Agent -> Analyst <-> Critic (retry
// loop) -> Writer.
//
// Design choice: this file takes an optional `onEvent` callback so the
// frontend can stream a live "agent activity feed" (per the PRD) via SSE.
// The orchestrator doesn't know or care HOW events are displayed — it just
// reports what's happening, when it happens.

import { runPlanner } from "@/agents/planner";
import { fetchFinancialsForPlan } from "@/lib/financialApi";
import { runAnalyst, reviseFinding } from "@/agents/analyst";
import { runCritic } from "@/agents/critic";
import { runWriter } from "@/agents/writer";
import { DraftFinding, FinalReport } from "@/types/agentContracts";

const MAX_REVISION_ROUNDS = 2;

export interface PipelineEvent {
  agent: "Planner" | "DataAgent" | "Analyst" | "Critic" | "Writer" | "Orchestrator";
  message: string;
  timestamp: number;
}

export type OnEvent = (event: PipelineEvent) => void;

function emit(onEvent: OnEvent | undefined, agent: PipelineEvent["agent"], message: string) {
  onEvent?.({ agent, message, timestamp: Date.now() });
}

/**
 * Runs the full FinBoard pipeline for a single user query.
 *
 * @param userQuery - the raw question, e.g. "Compare Nvidia and AMD's margins"
 * @param onEvent - optional callback fired on every agent step, for a live activity feed
 * @returns the final report, ready to render
 */
export async function runPipeline(
  userQuery: string,
  onEvent?: OnEvent
): Promise<FinalReport> {
  // 1. PLANNER
  emit(onEvent, "Planner", `Interpreting query: "${userQuery}"`);
  const plan = await runPlanner(userQuery);
  emit(
    onEvent,
    "Planner",
    `Identified ${plan.companies.join(", ")} — ${plan.reportType} report, metrics: ${plan.metrics.join(", ")}`
  );

  // 2. DATA AGENT
  emit(onEvent, "DataAgent", `Fetching financial data for ${plan.companies.join(", ")}...`);
  const dataset = await fetchFinancialsForPlan(plan.companies, plan.metrics, plan.timeframe.period);

  const missingTickers = plan.companies.filter((t) => (dataset[t] ?? []).length === 0);
  if (missingTickers.length > 0) {
    emit(onEvent, "DataAgent", `Warning: no data retrieved for ${missingTickers.join(", ")}`);
  }
  emit(onEvent, "DataAgent", `Data retrieved successfully`);

  // 3. ANALYST (first pass)
  emit(onEvent, "Analyst", `Analyzing data, drafting findings...`);
  let findings = await runAnalyst(dataset, plan);
  emit(onEvent, "Analyst", `Drafted ${findings.length} findings`);

  // 4. CRITIC <-> ANALYST retry loop
  let round = 0;
  let droppedFindings: { claim: string; reason: string }[] = [];

  while (round < MAX_REVISION_ROUNDS) {
    emit(onEvent, "Critic", `Reviewing ${findings.length} findings (round ${round + 1})...`);
    const review = await runCritic(findings, dataset);

    if (review.status === "approved") {
      emit(onEvent, "Critic", `All findings approved`);
      break;
    }

    emit(
      onEvent,
      "Critic",
      `Flagged ${review.issues?.length ?? 0} finding(s): ${review.issues
        ?.map((i) => `#${i.findingIndex} (${i.reason})`)
        .join("; ")}`
    );

    // Attempt a targeted fix for each flagged finding.
    const updatedFindings = [...findings];
    for (const issue of review.issues ?? []) {
      const original = findings[issue.findingIndex];
      if (!original) continue;

      try {
        emit(onEvent, "Analyst", `Revising finding #${issue.findingIndex}: "${original.claim}"`);
        const revised = await reviseFinding(original, issue.reason, dataset);
        updatedFindings[issue.findingIndex] = revised;
      } catch (err) {
        // If even the revision attempt fails validation, we don't want to
        // crash the whole pipeline over one bad finding — drop it and move on.
        emit(
          onEvent,
          "Analyst",
          `Could not repair finding #${issue.findingIndex}, will drop it`
        );
        droppedFindings.push({ claim: original.claim, reason: issue.reason });
        updatedFindings[issue.findingIndex] = null as unknown as DraftFinding; // mark for removal
      }
    }

    findings = updatedFindings.filter((f): f is DraftFinding => f !== null);
    round++;
  }

  // Final safety check: if we exhausted retries and the Critic still isn't
  // happy, drop the remaining flagged findings rather than ship a report
  // containing a claim we know is questionable. Shipping nothing wrong is
  // more important than shipping everything.
  const finalReview = await runCritic(findings, dataset);
  if (finalReview.status === "revise") {
    const stillBadIndices = new Set(finalReview.issues?.map((i) => i.findingIndex) ?? []);
    findings.forEach((f, i) => {
      if (stillBadIndices.has(i)) {
        droppedFindings.push({
          claim: f.claim,
          reason: finalReview.issues?.find((iss) => iss.findingIndex === i)?.reason ?? "unresolved",
        });
      }
    });
    findings = findings.filter((_, i) => !stillBadIndices.has(i));
    emit(
      onEvent,
      "Orchestrator",
      `Dropped ${droppedFindings.length} finding(s) that couldn't be verified after ${MAX_REVISION_ROUNDS} revision rounds`
    );
  }

  // 5. WRITER
  emit(onEvent, "Writer", `Composing final report from ${findings.length} approved findings...`);
  const report = await runWriter(findings, dataset, plan);

  // Surface any dropped findings as an honest caveat rather than silently
  // hiding that something was removed.
  if (droppedFindings.length > 0) {
    report.caveats.push(
      `${droppedFindings.length} potential finding(s) were excluded from this report because they could not be verified against the source data.`
    );
  }

  emit(onEvent, "Writer", `Report complete`);
  return report;
}