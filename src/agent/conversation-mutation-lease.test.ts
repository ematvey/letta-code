import { describe, expect, test } from "bun:test";
import {
  acquireConversationMutationLease,
  withConversationMutationLease,
} from "@/agent/conversation-mutation-lease";

describe("conversation mutation lease", () => {
  test("serializes mutations for the same conversation", async () => {
    const first = await acquireConversationMutationLease("agent-1", "conv-1");
    let secondStarted = false;
    const second = withConversationMutationLease(
      "agent-1",
      "conv-1",
      async () => {
        secondStarted = true;
      },
    );

    await Promise.resolve();
    expect(secondStarted).toBe(false);

    first.release();
    await second;
    expect(secondStarted).toBe(true);
  });

  test("does not serialize different conversations", async () => {
    const first = await acquireConversationMutationLease("agent-1", "conv-1");
    let otherStarted = false;
    await withConversationMutationLease("agent-1", "conv-2", async () => {
      otherStarted = true;
    });

    expect(otherStarted).toBe(true);
    first.release();
  });
});
