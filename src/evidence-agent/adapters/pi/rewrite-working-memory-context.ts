import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import type { MemoryLedger } from "../../model/ledger.js";
import { RewriteWorkingMemory } from "../../model/rewrite-working-memory.js";
import { WORKING_MEMORY_MAX_CHARS } from "../../model/working-memory.js";
import { createWorkingMemoryObservation } from "./working-memory-observation.js";
import { renderReadReceipts } from "./read-receipts.js";

export const REWRITE_WORKING_MEMORY_PROMPT = `
Context policy: working-memory-rewrite.
Every tool accepts the same optional workingMemory field. A string replaces your
current note; omission or null keeps it unchanged. No initial note is required.
Keep a short account of what the evidence supports, unresolved conflicts or gaps,
and useful source handles. Carry forward still-relevant facts when replacing it.
Do not invent evidence IDs or copy a transcript. Source handles are useful for
reopening evidence, but prose references are not tool commands or proof of a read.

The question, current note, brief read receipts and unacknowledged tool results
are retained. Each search presents its current candidates, including repeated hits.
A changed note after a successful action acknowledges the results you have already
seen. An identical note, omission, null, a rejected note or a failed action preserves them.
Keep the note within 1600 characters. A longer or empty note is not saved or
truncated; the tool still runs and reports that the note was not updated.
Read results produced by the current action remain visible for your next decision.
Read receipts come from successful reads, independently of your note. They are
short excerpts, not proof that the question is complete; reopen a listed C ref
when exact wording is needed.

Finish only after observing the previous results. Use sufficient when the exact
sources read cover the question, otherwise insufficient. A final note is optional.
The program commits the read sources, not the notebook. Pending or discarded
handles mentioned in prose do not impose extra reads. Do not discard a useful
lead merely to finish; continue when it can resolve a remaining evidence gap.
`;

/** Notes are optional annotations. Only real tool arguments authorize source reads. */
export function createRewriteWorkingMemoryContext(ledger: MemoryLedger, maxSearchCalls?: number) {
  const memory = new RewriteWorkingMemory(() => {});
  const observation = createWorkingMemoryObservation(ledger, maxSearchCalls, { refreshResults: true });
  const acknowledged = new Set<string>();
  const expiredNavigation = new Set<string>();
  const expiredReads = new Set<string>();
  let visible = new Set<string>();
  const noteParameters = Type.Optional(Type.Union([Type.String(), Type.Null()], {
    description: "Optional replacement progress note, up to 1600 characters. Omit or use null to keep it. A rejected note leaves earlier observations intact and does not block the action. No note is required to finish.",
  }));

  return {
    observation,
    availableTools: (tools: readonly AgentTool[]) => observation.searchesRemaining() === 0
      ? tools.filter(tool => tool.name !== "search") : [...tools],
    workingMemorySnapshot: () => memory.snapshot(),
    wrapTools(tools: readonly AgentTool[]): AgentTool[] {
      return tools.map(tool => {
        const parameters = tool.parameters as ReturnType<typeof Type.Object>;
        if (parameters.type !== "object" || !parameters.properties) {
          throw new Error(`Working-memory policy requires object arguments for ${tool.name}`);
        }
        return {
          ...tool,
          parameters: { ...parameters,
            properties: { ...parameters.properties, workingMemory: noteParameters },
            required: (parameters.required ?? []).filter(key => key !== "workingMemory"),
          },
          async execute(id, params, signal, onUpdate) {
            signal?.throwIfAborted();
            const { workingMemory, ...nativeParams } = params as Record<string, unknown>;
            const seen = [...visible];
            const next = typeof workingMemory === "string" ? workingMemory.trim() : undefined;
            const unchanged = workingMemory === undefined || workingMemory === null;
            const rejection = unchanged ? undefined
              : next === undefined || next.length === 0 ? "Expected a nonempty text note."
              : next.length > WORKING_MEMORY_MAX_CHARS
                ? `Note has ${next.length} characters; maximum is ${WORKING_MEMORY_MAX_CHARS}.` : undefined;
            // Failed native actions preserve both the previous note and observations.
            const result = await tool.execute(id, nativeParams, signal, onUpdate);
            const commit = memory.apply(unchanged || rejection ? undefined : next, id);
            const acknowledgedToolCallIds = commit.mode === "replace" ? seen : [];
            for (const resultId of acknowledgedToolCallIds) acknowledged.add(resultId);
            return { ...result,
              content: [...result.content, ...(rejection ? [{ type: "text" as const,
                text: `Working-memory note was not updated: ${rejection} The action succeeded. The previous note and earlier observations are retained. Write a shorter note on a later action if useful.` }] : [])],
              details: { ...result.details, workingMemoryUpdate: { ...commit, acknowledgedToolCallIds,
                ...(rejection ? { rejected: true, reason: rejection } : {}) } },
            };
          },
        };
      });
    },
    async transformContext(messages: AgentMessage[]): Promise<AgentMessage[]> {
      const pending = new Set(messages.flatMap(message => message.role === "toolResult" &&
        !acknowledged.has(message.toolCallId) ? [message.toolCallId] : []));
      visible = pending;
      const retained: AgentMessage[] = [];
      for (const message of messages) {
        if (message.role === "user") retained.push(message);
        else if (message.role === "assistant") {
          const content = message.content.filter(block => block.type === "toolCall" && pending.has(block.id));
          if (content.length) retained.push({ ...message, content });
        } else if (message.role === "toolResult") {
          if (pending.has(message.toolCallId)) {
            const { details: _audit, ...modelMessage } = message;
            retained.push(modelMessage);
          } else (message.toolName === "read" ? expiredReads : expiredNavigation).add(message.toolCallId);
        }
      }
      const firstAction = retained.findIndex(message => message.role !== "user");
      retained.splice(firstAction < 0 ? retained.length : firstAction, 0, {
        role: "user", timestamp: 0,
        content: memory.render() + "\n" + renderReadReceipts(ledger) +
          `\nSearch calls remaining: ${observation.searchesRemaining() ?? "unbounded"}.`,
      });
      return retained;
    },
    snapshot: () => ({ expiredNavigationResults: expiredNavigation.size, compactedReadResults: expiredReads.size }),
  };
}
