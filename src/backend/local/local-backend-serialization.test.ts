import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Stream } from "@letta-ai/letta-client/core/streaming";
import type { LettaStreamingResponse } from "@letta-ai/letta-client/resources/agents/messages";
import type { ConversationMessageCreateBody } from "@/backend";
import type { HeadlessTurnExecutor } from "@/backend/dev/headless-turn-executor";
import { LocalBackend } from "@/backend/local/local-backend";

function completedStream(): Stream<LettaStreamingResponse> {
  const controller = new AbortController();
  return new Stream(async function* () {
    yield {
      message_type: "stop_reason",
      stop_reason: "end_turn",
    } as LettaStreamingResponse;
  }, controller);
}

async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _chunk of stream) {
    // drain
  }
}

describe("local backend conversation serialization", () => {
  test("queues a second turn until the active stream is consumed", async () => {
    const storageDir = await mkdtemp(join(tmpdir(), "letta-local-serialize-"));
    try {
      const executor: HeadlessTurnExecutor = {
        async execute() {
          return completedStream();
        },
      };
      const backend = new LocalBackend({
        storageDir,
        executor,
        memfsEnabled: false,
      });
      const agent = await backend.createAgent({ name: "Local" } as never);
      const conversation = await backend.createConversation({
        agent_id: agent.id,
      } as never);
      const stream = await backend.createConversationMessageStream(
        conversation.id,
        {
          agent_id: agent.id,
          messages: [{ role: "user", content: "hello" }],
        } as ConversationMessageCreateBody,
      );

      let secondTurnCreated = false;
      const secondTurn = backend
        .createConversationMessageStream(conversation.id, {
          agent_id: agent.id,
          messages: [{ role: "user", content: "second" }],
        } as ConversationMessageCreateBody)
        .then((createdStream) => {
          secondTurnCreated = true;
          return createdStream;
        });
      await Promise.resolve();
      expect(secondTurnCreated).toBe(false);

      await drain(stream);
      const secondStream = await secondTurn;
      expect(secondTurnCreated).toBe(true);
      await drain(secondStream);
    } finally {
      await rm(storageDir, { recursive: true, force: true });
    }
  });
});
