import type { Stream } from "@letta-ai/letta-client/core/streaming";
import type { LettaStreamingResponse } from "@letta-ai/letta-client/resources/agents/messages";
import {
  acquireConversationMutationLease,
  type ConversationMutationLease,
} from "@/agent/conversation-mutation-lease";

function releaseLeaseAfterStream(
  stream: Stream<LettaStreamingResponse>,
  lease: ConversationMutationLease,
): Stream<LettaStreamingResponse> {
  const originalAsyncIterator = stream[Symbol.asyncIterator].bind(stream);
  const streamWithIterator = stream as Stream<LettaStreamingResponse> & {
    [Symbol.asyncIterator]: () => AsyncIterator<LettaStreamingResponse>;
  };
  streamWithIterator[Symbol.asyncIterator] = () => {
    const iterator = originalAsyncIterator();
    return {
      async next() {
        try {
          const result = await iterator.next();
          if (result.done) lease.release();
          return result;
        } catch (error) {
          lease.release();
          throw error;
        }
      },
      async return(value?: unknown) {
        try {
          if (iterator.return) return await iterator.return(value);
          return {
            done: true as const,
            value: value as LettaStreamingResponse,
          };
        } finally {
          lease.release();
        }
      },
      async throw(error?: unknown) {
        try {
          if (iterator.throw) return await iterator.throw(error);
          throw error;
        } finally {
          lease.release();
        }
      },
    };
  };
  return stream;
}

export async function createConversationMutationStream(
  agentId: string,
  conversationId: string,
  createStream: () => Promise<Stream<LettaStreamingResponse>>,
): Promise<Stream<LettaStreamingResponse>> {
  const lease = await acquireConversationMutationLease(agentId, conversationId);
  try {
    return releaseLeaseAfterStream(await createStream(), lease);
  } catch (error) {
    lease.release();
    throw error;
  }
}
