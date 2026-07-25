import { describe, expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { LettaStreamingResponse } from "@letta-ai/letta-client/resources/agents/messages";
import {
  type ProviderStreamAdapter,
  ProviderTurnExecutor,
  type ProviderTurnInput,
  providerLettaChunk,
  providerLocalMessage,
  providerStreamPart,
} from "@/backend/dev/provider-turn-executor";
import { emptyLocalUsage } from "@/backend/local/local-message";

function toolCallMessage(): AssistantMessage {
  return {
    role: "assistant",
    content: [
      { type: "text", text: "Checking the evidence." },
      {
        type: "toolCall",
        id: "call-bars",
        name: "get_simulation_minute_bars",
        arguments: {
          symbol: "SPY",
          start_utc: "2026-05-05T13:30:00Z",
          end_utc: "2026-05-05T13:35:00Z",
        },
      },
    ],
    api: "openai-responses",
    provider: "openai",
    model: "gpt-5.5",
    responseId: "response-tool-before-compaction",
    usage: {
      ...emptyLocalUsage(),
      input: 180_660,
      output: 100,
      totalTokens: 180_760,
    },
    stopReason: "toolUse",
    timestamp: Date.now(),
  };
}

function input(): ProviderTurnInput {
  return {
    conversationId: "conv-1",
    agentId: "agent-1",
    agent: {
      id: "agent-1",
      name: "Local",
      system: "system",
      model: "lmstudio/model",
      model_settings: { context_window_limit: 180_000 },
    } as never,
    body: {
      messages: [{ role: "user", content: "inspect the open" }],
    } as never,
    history: [],
    uiMessages: [],
    clientTools: [],
    clientSkills: [],
  };
}

async function collect(stream: AsyncIterable<LettaStreamingResponse>) {
  const chunks: LettaStreamingResponse[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("provider tool continuation across compaction", () => {
  test("emits requires_approval after compacting a tool-use response", async () => {
    const assistant = toolCallMessage();
    const toolCall = assistant.content[1];
    if (toolCall?.type !== "toolCall") {
      throw new Error("Expected the fixture to contain a tool call");
    }
    const adapter: ProviderStreamAdapter = {
      async *stream() {
        yield providerStreamPart({
          type: "toolcall_end",
          contentIndex: 1,
          toolCall,
          partial: assistant,
        });
        yield providerStreamPart({
          type: "done",
          reason: "toolUse",
          message: assistant,
        });
        yield providerLocalMessage(assistant as never);
        yield providerLettaChunk({
          message_type: "event_message",
          event_type: "compaction",
          event_data: { trigger: "context_window_limit" },
        } as never);
        yield providerLettaChunk({
          message_type: "summary_message",
          summary:
            "Older history compacted while the tool call remains pinned.",
        } as never);
      },
    };

    const chunks = await collect(
      await new ProviderTurnExecutor(adapter).execute(input()),
    );

    expect(
      chunks.map((chunk) => (chunk as { message_type?: string }).message_type),
    ).toEqual([
      "approval_request_message",
      "usage_statistics",
      "local_message",
      "event_message",
      "summary_message",
      "stop_reason",
    ]);
    expect(
      (chunks.at(-1) as { stop_reason?: string } | undefined)?.stop_reason,
    ).toBe("requires_approval");
  });
});
