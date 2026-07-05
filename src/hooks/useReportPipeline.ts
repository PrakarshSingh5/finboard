import { useState, useCallback, useRef } from "react";
import type { PipelineEvent } from "@/orchestrator/pipeline";
import type { FinalReport } from "@/types/agentContracts";

type Status = "idle" | "streaming" | "done" | "error" | "out-of-scope";

export function useReportPipeline() {
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [report, setReport] = useState<FinalReport | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // A ref (not state) to hold the abort controller, since it doesn't need
  // to trigger re-renders — it's just a handle we call .abort() on.
  const abortRef = useRef<AbortController | null>(null);

  const runQuery = useCallback(async (query: string) => {
    // Reset everything for a new query.
    setEvents([]);
    setReport(null);
    setErrorMessage(null);
    setStatus("streaming");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
        signal: controller.signal,
      });

      if (!response.body) {
        throw new Error("No response body from server");
      }

      // Manually reading the stream: fetch gives us a ReadableStream of raw
      // bytes. We decode it to text, then split on the SSE message boundary
      // ("\n\n") to get individual JSON messages.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSE messages are separated by a blank line. There may be more
        // than one complete message in the buffer, or a partial one at
        // the end — split carefully and keep the leftover in the buffer.
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? ""; // last part might be incomplete, keep it for next read

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const jsonStr = part.slice("data: ".length);
          const message = JSON.parse(jsonStr);

          if (message.type === "agent-event") {
            setEvents((prev) => [...prev, message.data as PipelineEvent]);
          } else if (message.type === "final-report") {
            setReport(message.data as FinalReport);
            setStatus("done");
          } else if (message.type === "out-of-scope") {
            setErrorMessage(message.data.message);
            setStatus("out-of-scope");
          } else if (message.type === "error") {
            setErrorMessage(message.data.message);
            setStatus("error");
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return; // user cancelled, not a real error
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    setStatus("idle");
  }, []);

  return { events, report, status, errorMessage, runQuery, cancel };
}