import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

const NAVIGATION_TOOLS = new Set(["search", "define_operator", "bash_ro"]);

export interface EphemeralContextSnapshot {
  expiredNavigationResults: number;
  compactedReadResults: number;
}

export interface EphemeralMemoryContext {
  transformContext(messages: AgentMessage[]): Promise<AgentMessage[]>;
  snapshot(): EphemeralContextSnapshot;
}

function isToolResult(message: AgentMessage): message is ToolResultMessage {
  return message.role === "toolResult";
}

function trailingToolResultStart(messages: readonly AgentMessage[]): number {
  let index = messages.length;
  while (index > 0 && isToolResult(messages[index - 1]!)) index -= 1;
  return index;
}

/**
 * Keeps the current tool batch visible once, then expires navigation payloads.
 * Full results remain in the audit trace and ledger; selected read evidence stays
 * in model context.
 */
export function createEphemeralMemoryContext(): EphemeralMemoryContext {
  const expiredNavigationIds = new Set<string>();
  const compactedReadIds = new Set<string>();
  return {
    async transformContext(messages): Promise<AgentMessage[]> {
      const currentBatchStart = trailingToolResultStart(messages);
      return messages.map((message, index) => {
        if (
          index >= currentBatchStart ||
          !isToolResult(message) ||
          (!NAVIGATION_TOOLS.has(message.toolName) && message.toolName !== "read") ||
          message.isError
        ) {
          return message;
        }
        const read = message.toolName === "read";
        if (read) compactedReadIds.add(message.toolCallId);
        else expiredNavigationIds.add(message.toolCallId);
        return {
          ...message,
          content: [{
            type: "text" as const,
            text: read
              ? "[read evidence text compacted after one reasoning turn; it remains eligible for citation and in the audit trace. Re-read the candidate if exact wording is needed again.]"
              : `[${message.toolName} navigation output expired from active ` +
                "context; full output remains in the audit trace. Read selected " +
                "candidate numbers or run a focused search for an uncovered subclaim.]",
          }],
        };
      });
    },
    snapshot(): EphemeralContextSnapshot {
      return {
        expiredNavigationResults: expiredNavigationIds.size,
        compactedReadResults: compactedReadIds.size,
      };
    },
  };
}
