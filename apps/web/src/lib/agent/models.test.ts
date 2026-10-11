import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

const invoked: unknown[][] = [];

// A stand-in for the real chat model, so the test sees what would be sent and calls nothing.
vi.mock("@langchain/anthropic", () => ({
  ChatAnthropic: class {
    bindTools() {
      return this;
    }
    async invoke(messages: unknown[]) {
      invoked.push(messages);
      return new AIMessage({ content: "ok" });
    }
  },
}));

const { createAgentModel, withCachedSystemPrompt } = await import("./models");

describe("withCachedSystemPrompt", () => {
  it("marks the system prompt as a cache breakpoint and leaves the rest alone", () => {
    const question = new HumanMessage("What does Kael carry?");
    const [system, ...rest] = withCachedSystemPrompt([new SystemMessage("rules"), question]);

    expect(system.content).toEqual([
      { type: "text", text: "rules", cache_control: { type: "ephemeral" } },
    ]);
    expect(rest).toEqual([question]);
  });

  it("leaves a request without a system prompt as it is", () => {
    const messages = [new HumanMessage("hello")];
    expect(withCachedSystemPrompt(messages)).toBe(messages);
  });
});

describe("the drafting model", () => {
  const question = new HumanMessage("What does Kael carry?");

  it("caches the prompt on a call that offers the tools", async () => {
    invoked.length = 0;
    const model = createAgentModel({ apiKey: "test", modelId: "claude-sonnet-5-5" });
    await model([new SystemMessage("rules"), question], { allowTools: true }, {});

    const sent = invoked[0] as SystemMessage[];
    expect(sent[0].content).toEqual([
      { type: "text", text: "rules", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("sends the last call of a draft, which has no tools, without a marker", async () => {
    invoked.length = 0;
    const model = createAgentModel({ apiKey: "test", modelId: "claude-sonnet-5-5" });
    await model([new SystemMessage("rules"), question], { allowTools: false }, {});

    const sent = invoked[0] as SystemMessage[];
    expect(sent[0].content).toBe("rules");
  });
});
