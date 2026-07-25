const CONVERSATION_MUTATION_QUEUE_KEY = Symbol.for(
  "@letta/conversationMutationQueue",
);

interface ConversationMutationQueue {
  tails: Map<string, Promise<void>>;
}

type GlobalWithConversationMutationQueue = typeof globalThis & {
  [CONVERSATION_MUTATION_QUEUE_KEY]?: ConversationMutationQueue;
};

export interface ConversationMutationLease {
  release(): void;
}

function getQueue(): ConversationMutationQueue {
  const global = globalThis as GlobalWithConversationMutationQueue;
  global[CONVERSATION_MUTATION_QUEUE_KEY] ??= { tails: new Map() };
  return global[CONVERSATION_MUTATION_QUEUE_KEY];
}

function mutationKey(agentId: string, conversationId: string): string {
  return `${agentId}\u0000${conversationId}`;
}

/**
 * Serializes state-changing work for one durable conversation.
 *
 * The lease is process-global so bundled copies of the module coordinate with
 * each other. Callers must hold it across streamed turns, not only stream
 * creation, because local compaction and transcript persistence happen while
 * the stream is consumed.
 */
export async function acquireConversationMutationLease(
  agentId: string,
  conversationId: string,
): Promise<ConversationMutationLease> {
  const queue = getQueue();
  const key = mutationKey(agentId, conversationId);
  const predecessor = queue.tails.get(key) ?? Promise.resolve();
  let releaseGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const tail = predecessor.then(
    () => gate,
    () => gate,
  );
  queue.tails.set(key, tail);

  await predecessor.catch(() => {});

  let released = false;
  return {
    release(): void {
      if (released) return;
      released = true;
      releaseGate?.();
      void tail.then(() => {
        if (queue.tails.get(key) === tail) {
          queue.tails.delete(key);
        }
      });
    },
  };
}

export async function withConversationMutationLease<T>(
  agentId: string,
  conversationId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lease = await acquireConversationMutationLease(agentId, conversationId);
  try {
    return await operation();
  } finally {
    lease.release();
  }
}
