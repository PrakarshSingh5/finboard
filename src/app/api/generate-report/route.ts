// src/app/api/generate-report/route.ts
//
// This route runs the full agent pipeline and STREAMS progress back to the
// browser using Server-Sent Events (SSE), instead of making the user wait
// silently for ~30 seconds and then dumping the whole result at once.
//
// How SSE works here: we return a `ReadableStream` as the response body.
// Each chunk we write is a small text block formatted as `data: {...}\n\n`.
// The browser's `EventSource` (or a manual fetch reader, which we use on
// the frontend) reads these chunks one at a time as they arrive.

import { runPipeline, PipelineEvent } from "@/orchestrator/pipeline";
import { OutOfScopeError } from "@/agents/guardrail";
import { FinalReport } from "@/types/agentContracts";

export const runtime = "nodejs"; // ensure this doesn't run on the Edge runtime, since our agents use plain fetch + env vars freely here

const MAX_QUERY_LENGTH = 300;

// Every message we stream down has one of these shapes. "error" is split
// into two kinds so the frontend can style them differently: a scope
// rejection is an expected, calm boundary ("this tool doesn't do that"),
// not a scary "something broke" failure.
type StreamMessage =
  | { type: "agent-event"; data: PipelineEvent }
  | { type: "final-report"; data: FinalReport }
  | { type: "out-of-scope"; data: { message: string } }
  | { type: "error"; data: { message: string } };

function formatSseMessage(message: StreamMessage): string {
  // The `data: ...\n\n` format (with a blank line after) is the SSE spec —
  // browsers won't parse it correctly without that trailing double newline.
  return `data: ${JSON.stringify(message)}\n\n`;
}

export async function POST(req: Request) {
  const { query } = (await req.json()) as { query: string };

  if (!query || typeof query !== "string" || !query.trim()) {
    return new Response(JSON.stringify({ error: "Missing 'query' in request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (query.length > MAX_QUERY_LENGTH) {
    return new Response(
      JSON.stringify({ error: `Query too long (max ${MAX_QUERY_LENGTH} characters)` }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // This callback is what the orchestrator calls after every agent step.
      // We immediately forward each event down the stream as it happens.
      const onEvent = (event: PipelineEvent) => {
        controller.enqueue(
          encoder.encode(formatSseMessage({ type: "agent-event", data: event }))
        );
      };

      try {
        const report = await runPipeline(query.trim(), onEvent);
        controller.enqueue(
          encoder.encode(formatSseMessage({ type: "final-report", data: report }))
        );
      } catch (err) {
        if (err instanceof OutOfScopeError) {
          controller.enqueue(
            encoder.encode(formatSseMessage({ type: "out-of-scope", data: { message: err.message } }))
          );
        } else {
          const message = err instanceof Error ? err.message : "Unknown pipeline error";
          controller.enqueue(
            encoder.encode(formatSseMessage({ type: "error", data: { message } }))
          );
        }
      } finally {
        // Always close the stream, success or failure — otherwise the
        // browser's fetch reader hangs open forever waiting for more.
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}