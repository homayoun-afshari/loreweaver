import { toBaseMessages } from "@ai-sdk/langchain";
import { validateUIMessages } from "ai";
import { describe, expect, it } from "vitest";
import { splitCurrentRun, textOf } from "@/lib/agent/messages";
import type { ChatMessage } from "./chat-message";
import { createTools } from "./tools";

/**
 * The browser sends the whole conversation, with the tool parts of earlier answers. The route
 * validates it and converts it for the graph. These tests use the same two library calls.
 */

const history: ChatMessage[] = [
  { id: "u1", role: "user", parts: [{ type: "text", text: "Where is Aria?" }] },
  {
    id: "a1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "tool-fetch_character_state",
        toolCallId: "toolu_1",
        state: "output-available",
        input: { character_id: "1" },
        output: {
          ok: true,
          character: {
            id: 1,
            name: "Aria Voss",
            worldId: "world_aethel",
            location: { code: 17, name: "Ice Citadel" },
            inventory: ["flint"],
            mana: 20,
            hp: 85,
            condition: "healthy",
            updatedAt: "2026-10-09T14:32:00.000Z",
          },
        },
      },
      { type: "step-start" },
      { type: "text", text: "She is in the Ice Citadel." },
    ],
  },
  { id: "u2", role: "user", parts: [{ type: "text", text: "How can she escape?" }] },
];

describe("the conversation the browser sends", () => {
  it("passes validation against the chat tools", async () => {
    await expect(
      validateUIMessages({ messages: history, tools: createTools({ worldId: "world_aethel" }) }),
    ).resolves.toHaveLength(3);
  });

  it("becomes messages with each tool call followed by its result", async () => {
    const messages = await toBaseMessages(history);
    expect(messages.map((m) => m.type)).toEqual(["human", "ai", "tool", "ai", "human"]);
    const [, call, result] = messages;
    expect(
      (call as { tool_calls?: { id?: string; name: string }[] }).tool_calls?.[0],
    ).toMatchObject({
      id: "toolu_1",
      name: "fetch_character_state",
    });
    expect((result as unknown as { tool_call_id: string }).tool_call_id).toBe("toolu_1");
    expect(JSON.parse(textOf(result)).character.name).toBe("Aria Voss");
  });

  it("leaves the earlier tool results out of this run's evidence", async () => {
    const { question, run } = splitCurrentRun(await toBaseMessages(history));
    expect(question).toBe("How can she escape?");
    expect(run).toEqual([]);
  });
});
