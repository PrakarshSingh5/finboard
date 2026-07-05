// src/components/AgentActivityFeed.tsx
//
// The signature visual element of the whole app: a real console log, not a
// generic "loading" list. Monospace timestamps, a colored left-border bar
// per agent (color-coding at a glance which agent is speaking), and a
// blinking cursor at the end while the stream is still active — mimicking
// tailing a live log file, which is a fitting metaphor for watching a
// multi-agent pipeline actually run.

"use client";

import type { PipelineEvent } from "@/orchestrator/pipeline";

interface AgentActivityFeedProps {
  events: PipelineEvent[];
  isStreaming?: boolean;
}

const AGENT_COLOR: Record<PipelineEvent["agent"], string> = {
  Cache: "border-gain text-gain",
  Guardrail: "border-agent-orchestrator text-agent-orchestrator",
  Planner: "border-agent-planner text-agent-planner",
  DataAgent: "border-agent-data text-agent-data",
  Analyst: "border-agent-analyst text-agent-analyst",
  Critic: "border-agent-critic text-agent-critic",
  Writer: "border-agent-writer text-agent-writer",
  Orchestrator: "border-agent-orchestrator text-agent-orchestrator",
};

// Safety net: if a new agent is ever added to the pipeline and someone
// forgets to add a matching color here (exactly what just happened with
// Guardrail), fall back to a neutral style instead of crashing the whole
// feed. TypeScript's Record<> type should catch this at compile time, but
// Next.js's dev server transpiles without full type-checking, so this
// runtime fallback is a deliberate second layer of defense.
const DEFAULT_COLOR = "border-hairline text-ink-muted";

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toTimeString().slice(0, 8); // HH:MM:SS
}

export function AgentActivityFeed({ events, isStreaming }: AgentActivityFeedProps) {
  if (events.length === 0) return null;

  return (
    <div className="console-texture w-full rounded-lg border border-hairline bg-surface p-4 max-h-80 overflow-y-auto">
      <div className="space-y-1.5">
        {events.map((event, i) => {
          const colorClasses = AGENT_COLOR[event.agent] ?? DEFAULT_COLOR;
          return (
            <div
              key={i}
              className={`flex items-start gap-3 border-l-2 pl-3 py-0.5 text-sm ${colorClasses.split(" ")[0]}`}
            >
              <span className="shrink-0 font-mono text-xs text-ink-faint pt-0.5">
                {formatTime(event.timestamp)}
              </span>
              <span className={`shrink-0 font-mono text-xs font-semibold ${colorClasses.split(" ")[1]} pt-0.5`}>
                {event.agent}
              </span>
              <span className="font-body text-ink-muted">{event.message}</span>
            </div>
          );
        })}
        {isStreaming && (
          <div className="flex items-center gap-3 pl-3">
            <span className="font-mono text-signal animate-blink">▍</span>
          </div>
        )}
      </div>
    </div>
  );
}