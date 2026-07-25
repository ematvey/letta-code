import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { LettaStreamingResponse } from "@letta-ai/letta-client/resources/agents/messages";
import type { ConversationMessageCreateBody } from "@/backend";
import type { HeadlessTurnExecutor } from "@/backend/dev/headless-turn-executor";
import { LocalBackend } from "@/backend/local/local-backend";
import { emptyLocalUsage } from "@/backend/local/local-message";

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) {
    // Drain the persisted turn before compacting it.
  }
}

function completedExecutor(): HeadlessTurnExecutor {
  return {
    async execute() {
      const controller = new AbortController();
      return {
        controller,
        async *[Symbol.asyncIterator]() {
          yield {
            message_type: "assistant_message",
            content: [{ type: "text", text: "ready" }],
          } as LettaStreamingResponse;
          yield {
            message_type: "stop_reason",
            stop_reason: "end_turn",
          } as LettaStreamingResponse;
        },
      } as never;
    },
  };
}

function compactionResult(): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: "Compacted history." }],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5.5",
    responseId: "summary-response",
    usage: emptyLocalUsage(),
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

describe("local compaction progress", () => {
  test("notification-only compact hooks cannot strand a persisted compaction", async () => {
    const storageDir = await mkdtemp(
      join(tmpdir(), "local-compaction-progress-"),
    );
    try {
      const backend = new LocalBackend({
        storageDir,
        executor: completedExecutor(),
        complete: async () => compactionResult(),
        memfsEnabled: false,
      });
      const agent = await backend.createAgent({ name: "Local" } as never);
      const conversation = await backend.createConversation({
        agent_id: agent.id,
      } as never);
      await drain(
        await backend.createConversationMessageStream(conversation.id, {
          agent_id: agent.id,
          messages: [{ role: "user", content: "hello" }],
        } as ConversationMessageCreateBody),
      );

      let compactEndStarted = false;
      backend.setModEventHooks({
        onCompactEnd: async () => {
          compactEndStarted = true;
          await new Promise<never>(() => {});
        },
      });

      const result = await backend.compactConversationMessages(
        conversation.id,
        { agent_id: agent.id } as never,
      );

      expect(result.summary).toBe("Compacted history.");
      expect(compactEndStarted).toBe(true);
      const messages = await backend.listConversationMessages(conversation.id, {
        agent_id: agent.id,
        order: "asc",
      } as never);
      expect(messages.getPaginatedItems()).toHaveLength(1);
      expect(messages.getPaginatedItems()[0]?.message_type).toBe(
        "summary_message",
      );
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });
});
