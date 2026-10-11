import { HumanMessage, ToolMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";
import { agentRunConfig, createAgentGraph, createAgentTools } from "@/lib/agent";
import {
  asksFor,
  draft,
  fakeAgentModel,
  fakeReflectionModel,
  invalid,
  toolCall,
  valid,
} from "@/lib/agent/testing";
import type { LegacyClient } from "@/lib/legacy/client";
import { CHECKING_TEXT, writeAgentRun, type ChunkSink } from "./agent-stream";
import { createChatTimer } from "./server-timing";

type Chunk = Parameters<ChunkSink["write"]>[0];

async function* feed(...updates: Record<string, unknown>[]) {
  for (const update of updates) yield update;
}

/** Runs the translator over some updates and returns what it wrote. */
async function run(updates: AsyncIterable<unknown>, now: () => number = () => 0) {
  const chunks: Chunk[] = [];
  const timer = createChatTimer(now);
  await writeAgentRun({
    sink: { write: (chunk) => chunks.push(chunk) },
    updates,
    timer,
    meta: { modelId: "claude-sonnet-5-5", promptVersion: "agent.v2" },
  });
  return chunks;
}

const types = (chunks: Chunk[]) => chunks.map((c) => c.type);
const noTokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const usage = (agent: [number, number], reflection: [number, number]) => ({
  agent: { input: agent[0], output: agent[1], cacheRead: 0, cacheWrite: 0 },
  reflection: { input: reflection[0], output: reflection[1], cacheRead: 0, cacheWrite: 0 },
});
const result = (
  id: string,
  name: string,
  value: unknown,
  status: "success" | "error" = "success",
) =>
  new ToolMessage({
    content: typeof value === "string" ? value : JSON.stringify(value),
    tool_call_id: id,
    name,
    status,
  });

describe("writeAgentRun", () => {
  it("sends tool progress as it happens and the answer once, at the end", async () => {
    const chunks = await run(
      feed(
        {
          agent: {
            messages: [asksFor(toolCall("fetch_character_state", { character_id: "1" }, "c1"))],
            draftAnswer: "",
          },
        },
        {
          tools: {
            messages: [result("c1", "fetch_character_state", { ok: true, character: { id: 1 } })],
          },
        },
        { agent: { messages: [draft("Use the flint.")], draftAnswer: "Use the flint." } },
        { reflect: { reflection: { valid: true, violations: [] } } },
      ),
    );

    expect(types(chunks)).toEqual([
      "start",
      "start-step",
      "tool-input-available",
      "tool-output-available",
      "finish-step",
      "data-status",
      "start-step",
      "text-start",
      "text-delta",
      "text-end",
      "finish-step",
      "finish",
    ]);
    expect(chunks[2]).toMatchObject({
      toolCallId: "c1",
      toolName: "fetch_character_state",
      input: { character_id: "1" },
    });
    // A typed (static) tool part, so the cards that read `tool-fetch_character_state` match it.
    expect(chunks[2]).not.toHaveProperty("dynamic");
    expect(chunks[3]).toMatchObject({
      toolCallId: "c1",
      output: { ok: true, character: { id: 1 } },
    });
    expect(chunks[5]).toEqual({
      type: "data-status",
      data: { text: CHECKING_TEXT },
      transient: true,
    });
    expect(chunks[8]).toMatchObject({ type: "text-delta", delta: "Use the flint." });
  });

  it("never sends a rejected draft, the verdict or the feedback", async () => {
    const chunks = await run(
      feed(
        { agent: { messages: [draft("Burn the door.")], draftAnswer: "Burn the door." } },
        {
          reflect: {
            reflection: {
              valid: false,
              violations: [{ rule_id: "inventory", explanation: "No flint." }],
            },
            iterations: 1,
            messages: [new HumanMessage("Your draft was checked: [inventory] No flint.")],
          },
        },
        { agent: { messages: [draft("Find flint first.")], draftAnswer: "Find flint first." } },
        { reflect: { reflection: { valid: true, violations: [] } } },
      ),
    );
    const everything = JSON.stringify(chunks);
    expect(everything).not.toContain("Burn the door.");
    expect(everything).not.toContain("inventory");
    expect(everything).not.toContain("No flint");
    const text = chunks.filter((c) => c.type === "text-delta");
    expect(text).toHaveLength(1);
    expect(text[0]).toMatchObject({ delta: "Find flint first." });
    // The status note went out for each draft that was about to be checked.
    expect(chunks.filter((c) => c.type === "data-status")).toHaveLength(2);
  });

  it("sends the best draft with its caveat when the reflection node set one", async () => {
    const withCaveat = "Draft 3\n\nNote: this answer may still conflict with the world's rules.";
    const chunks = await run(
      feed(
        { agent: { messages: [draft("Draft 3")], draftAnswer: "Draft 3" } },
        { reflect: { reflection: { valid: false, violations: [] }, draftAnswer: withCaveat } },
      ),
    );
    expect(chunks.find((c) => c.type === "text-delta")).toMatchObject({ delta: withCaveat });
  });

  it("answers a tool that failed with an error part, not a card of made-up data", async () => {
    const chunks = await run(
      feed(
        { agent: { messages: [asksFor(toolCall("search_lore", { query: "x" }, "c2"))] } },
        {
          tools: {
            messages: [
              result(
                "c2",
                "search_lore",
                { ok: false, error: { kind: "tool_error", message: "search_lore failed." } },
                "error",
              ),
            ],
          },
        },
      ),
    );
    expect(chunks.find((c) => c.type === "tool-output-error")).toMatchObject({
      toolCallId: "c2",
      errorText: "search_lore failed.",
    });
    expect(types(chunks)).not.toContain("tool-output-available");
  });

  it("treats an unreadable tool result as an error", async () => {
    const chunks = await run(
      feed(
        { agent: { messages: [asksFor(toolCall("search_lore", { query: "x" }, "c3"))] } },
        { tools: { messages: [result("c3", "search_lore", "not json")] } },
      ),
    );
    expect(chunks.find((c) => c.type === "tool-output-error")).toMatchObject({
      toolCallId: "c3",
    });
  });

  it("gives a call without an id the same fallback id as the tools node", async () => {
    const noId = asksFor({ ...toolCall("search_lore", { query: "x" }), id: undefined as never });
    const chunks = await run(feed({ agent: { messages: [noId] } }));
    expect(chunks.find((c) => c.type === "tool-input-available")).toMatchObject({
      toolCallId: "call_0",
    });
  });

  it("keeps steps balanced and sends no text when there is no answer", async () => {
    const chunks = await run(
      feed({ agent: { messages: [asksFor(toolCall("search_lore", { query: "x" }, "c4"))] } }),
    );
    const starts = chunks.filter((c) => c.type === "start-step").length;
    const finishes = chunks.filter((c) => c.type === "finish-step").length;
    expect(starts).toBe(finishes);
    expect(types(chunks)).not.toContain("text-delta");
    expect(types(chunks).at(-1)).toBe("finish");
  });

  it("finishes with the model, the prompt, both token counts and the timing", async () => {
    let clock = 0;
    const chunks = await run(
      feed(
        {
          agent: {
            messages: [asksFor(toolCall("search_lore", { query: "x" }, "c5"))],
            usage: usage([1000, 50], [0, 0]),
          },
        },
        { tools: { messages: [result("c5", "search_lore", { ok: true, hits: [] })] } },
        {
          agent: {
            messages: [draft("An answer.")],
            draftAnswer: "An answer.",
            usage: usage([1200, 80], [0, 0]),
          },
        },
        {
          reflect: { reflection: { valid: true, violations: [] }, usage: usage([0, 0], [300, 20]) },
        },
      ),
      () => (clock += 100),
    );
    const finish = chunks.at(-1);
    expect(finish).toMatchObject({
      type: "finish",
      messageMetadata: {
        modelId: "claude-sonnet-5-5",
        promptVersion: "agent.v2",
        inputTokens: 2200,
        outputTokens: 130,
        reflectionInputTokens: 300,
        reflectionOutputTokens: 20,
      },
    });
    const meta = (finish as unknown as { messageMetadata: Record<string, number> }).messageMetadata;
    // The first tool call reached the browser before the answer did.
    expect(meta.serverFirstUiMs).toBeGreaterThan(0);
    expect(meta.serverTtftMs).toBeGreaterThan(meta.serverFirstUiMs);
    expect(meta.serverTotalMs).toBeGreaterThanOrEqual(meta.serverTtftMs);
    expect(noTokens).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("lets a failing run fail, after the message has started", async () => {
    async function* failing() {
      yield { agent: { messages: [asksFor(toolCall("search_lore", { query: "x" }, "c6"))] } };
      throw new Error("provider down");
    }
    const chunks: Chunk[] = [];
    await expect(
      writeAgentRun({
        sink: { write: (chunk) => chunks.push(chunk) },
        updates: failing(),
        timer: createChatTimer(),
        meta: {},
      }),
    ).rejects.toThrow("provider down");
    expect(chunks[0]).toEqual({ type: "start" });
  });
});

describe("the real graph through the translator", () => {
  it("catches a forced violation, and only the fixed answer reaches the browser", async () => {
    const aria = {
      id: 1,
      name: "Aria Voss",
      worldId: "world_aethel",
      location: { code: 17, name: "Ice Citadel" },
      inventory: ["flint"],
      mana: 20,
      hp: 85,
      condition: "healthy",
      updatedAt: "2026-10-09T14:32:00.000Z",
    };
    const agent = fakeAgentModel([
      asksFor(toolCall("fetch_character_state", { character_id: "1" }, "a1")),
      draft("Cast a fireball at the door."),
      draft("Strike the flint to melt the door."),
    ]);
    const reflection = fakeReflectionModel([
      invalid({ rule_id: "3fa9c1d2", explanation: "Fire magic needs flint in the Citadel." }),
      valid,
    ]);
    const graph = createAgentGraph({
      agentModel: agent.model,
      reflectionModel: reflection.model,
      systemPromptFor: () => "system",
      toolsFor: (worldId) =>
        createAgentTools({
          worldId,
          getClient: () =>
            ({
              getCharacterState: vi.fn().mockResolvedValue({ ok: true, value: aria }),
            }) as unknown as LegacyClient,
          searchLore: vi.fn(),
        }),
    });

    const chunks = await run(
      await graph.stream(
        { messages: [new HumanMessage("How does Aria escape?")] },
        { ...agentRunConfig("world_aethel"), streamMode: "updates" },
      ),
    );

    const everything = JSON.stringify(chunks);
    expect(everything).not.toContain("fireball");
    expect(everything).not.toContain("Fire magic needs flint");
    expect(chunks.filter((c) => c.type === "text-delta")).toEqual([
      { type: "text-delta", id: "answer", delta: "Strike the flint to melt the door." },
    ]);
    expect(chunks.find((c) => c.type === "tool-output-available")).toMatchObject({
      toolCallId: "a1",
      output: { ok: true, character: { name: "Aria Voss" } },
    });
    // The two checks used tokens, and the fake reports them, so they are in the metadata.
    expect(chunks.at(-1)).toMatchObject({
      messageMetadata: { reflectionInputTokens: 200, reflectionOutputTokens: 20 },
    });
  });
});

describe("writeAgentRun: reporting the tokens", () => {
  it("reports the tokens spent so far each time they grow, also when the run fails later", async () => {
    const seen: number[] = [];
    async function* failingAfterTwoSteps() {
      yield { agent: { messages: [draft("Draft")], usage: usage([100, 10], [0, 0]) } };
      yield { reflect: { usage: usage([0, 0], [50, 5]) } };
      throw new Error("provider down");
    }
    await expect(
      writeAgentRun({
        sink: { write: () => {} },
        updates: failingAfterTwoSteps(),
        timer: createChatTimer(() => 0),
        meta: { modelId: "claude-sonnet-5-5", promptVersion: "agent.v3" },
        onUsage: (spent) => seen.push(spent.agent.input + spent.reflection.input),
      }),
    ).rejects.toThrow("provider down");
    // After the first update only the drafting tokens were known, after the second both.
    expect(seen).toEqual([100, 150]);
  });
});
