import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentGraph, createAgentTools, type AgentGraph } from "@/lib/agent";
import {
  asksFor,
  draft,
  fakeAgentModel,
  fakeReflectionModel,
  invalid,
  toolCall,
  valid,
} from "@/lib/agent/testing";
import type { CharacterState } from "@/lib/legacy";
import type { LegacyClient } from "@/lib/legacy/client";
import { WORLD_COOKIE } from "@/lib/session";
import { createUsageGuard, type UsageGuard } from "@/lib/usage/guard";
import { finishedWith, memoryUsageStore, type MemoryRow } from "@/lib/usage/testing";
import { VISITOR_COOKIE } from "@/lib/visitor";

/**
 * The chat route with fake models and fake tool back ends: the real request checks, the real
 * graph and the real stream writer, with no network, database or key.
 */

const requested: { modelId?: string; worldIds: string[] } = { worldIds: [] };
let makeGraph: () => AgentGraph;

vi.mock("@/lib/ai/agent-runtime", () => ({
  getAgentGraph: (modelId: string) => {
    requested.modelId = modelId;
    return makeGraph();
  },
}));

// `after()` only works inside a real Next.js request.
vi.mock("@/lib/ai/tracing", () => ({ flushTracesAfterResponse: vi.fn() }));

// The usage guard on an in-memory store, with small limits, instead of the database.
let usageGuard: UsageGuard;
let usageRows: MemoryRow[];
vi.mock("@/lib/usage/runtime", () => ({ getUsageGuard: () => usageGuard }));

const { POST } = await import("./route");

const aria: CharacterState = {
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

/** A graph whose models follow a script. Records the world each run's tools were built for. */
function scriptedGraph(args: {
  agent: Parameters<typeof fakeAgentModel>[0];
  reflection: unknown[];
}) {
  const agent = fakeAgentModel(args.agent);
  const reflection = fakeReflectionModel(args.reflection);
  makeGraph = () =>
    createAgentGraph({
      agentModel: agent.model,
      reflectionModel: reflection.model,
      systemPromptFor: () => "system",
      toolsFor: (worldId) => {
        requested.worldIds.push(worldId);
        return createAgentTools({
          worldId,
          getClient: () =>
            ({
              getCharacterState: vi.fn().mockResolvedValue({ ok: true, value: aria }),
            }) as unknown as LegacyClient,
          searchLore: vi.fn().mockResolvedValue({ ok: true, hits: [] }),
        });
      },
    });
  return { agent, reflection };
}

const userMessage = (text: string) => ({
  id: "u1",
  role: "user",
  parts: [{ type: "text", text }],
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/** The chunks of a streamed response. */
async function chunksOf(response: Response) {
  const text = await response.text();
  return text
    .split("\n\n")
    .filter((event) => event.startsWith("data: ") && event !== "data: [DONE]")
    .map((event) => JSON.parse(event.slice(6)) as Record<string, unknown>);
}

beforeEach(() => {
  requested.modelId = undefined;
  requested.worldIds = [];
  scriptedGraph({ agent: [draft("An answer.")], reflection: [valid] });
  const memory = memoryUsageStore();
  usageRows = memory.rows;
  usageGuard = createUsageGuard({
    store: memory.store,
    limits: { requestsPerMinute: 3, dailyTokenBudget: 1000 },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/chat", () => {
  it.each([
    ["not JSON", "{nope"],
    ["no messages", {}],
    ["an empty list", { messages: [] }],
    ["a list that is too long", { messages: Array.from({ length: 31 }, () => userMessage("hi")) }],
  ])("rejects a request with %s", async (_name, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid request." });
  });

  it("answers a message over the length limit with 413 and a sentence the chat can show", async () => {
    const response = await post({ messages: [userMessage("x".repeat(8_001))] });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "message_too_long",
      message: expect.stringContaining("8,000 characters"),
      maxChars: 8_000,
    });
    // Nothing was spent on it: it is refused before the limits and the model.
    expect(usageRows).toHaveLength(0);
  });

  it("accepts a message at the length limit", async () => {
    const response = await post({ messages: [userMessage("x".repeat(8_000))] });
    expect(response.status).toBe(200);
    await response.text();
  });

  it("rejects a conversation whose earlier tool parts do not match the tools", async () => {
    const forged = {
      id: "a1",
      role: "assistant",
      parts: [
        {
          type: "tool-search_lore",
          toolCallId: "t1",
          state: "output-available",
          input: { query: 12345 },
          output: { ok: true, hits: [] },
        },
      ],
    };
    const response = await post({ messages: [userMessage("hi"), forged, userMessage("again")] });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid messages." });
  });

  it("streams tool parts, the status note, one answer and the metadata", async () => {
    scriptedGraph({
      agent: [
        asksFor(toolCall("fetch_character_state", { character_id: "1" }, "c1")),
        draft("Light the flint."),
      ],
      reflection: [valid],
    });
    const response = await post({ messages: [userMessage("How can Aria escape?")] });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const chunks = await chunksOf(response);
    const types = chunks.map((c) => c.type);
    expect(types.at(0)).toBe("start");
    expect(types.at(-1)).toBe("finish");
    expect(types).toContain("tool-input-available");
    expect(types).toContain("tool-output-available");
    expect(types).toContain("data-status");
    expect(chunks.filter((c) => c.type === "text-delta")).toHaveLength(1);
    expect(chunks.find((c) => c.type === "tool-output-available")).toMatchObject({
      toolCallId: "c1",
      output: { ok: true, character: { name: "Aria Voss" } },
    });
    expect(chunks.at(-1)).toMatchObject({
      messageMetadata: { modelId: "claude-haiku-4-5", promptVersion: "agent.v6" },
    });
  });

  it("never sends a draft that the check rejected", async () => {
    scriptedGraph({
      agent: [draft("Burn the door with a fire spell."), draft("Use the flint.")],
      reflection: [invalid({ rule_id: "inventory", explanation: "No flint." }), valid],
    });
    const body = await (await post({ messages: [userMessage("Escape?")] })).text();
    expect(body).not.toContain("fire spell");
    expect(body).not.toContain("No flint");
    expect(body).toContain("Use the flint.");
  });

  it("runs in the world of the session, and falls back to the default for an unknown one", async () => {
    for (const cookie of [`${WORLD_COOKIE}=world_nox`, `${WORLD_COOKIE}=world_made_up`, ""]) {
      // The tools are built when the agent first asks for one, so each run asks for one.
      scriptedGraph({
        agent: [asksFor(toolCall("search_lore", { query: "x" })), draft("Done.")],
        reflection: [valid],
      });
      await (await post({ messages: [userMessage("Hi")] }, { cookie })).text();
    }
    expect(requested.worldIds).toEqual(["world_nox", "world_aethel", "world_aethel"]);
  });

  it("chooses the model: a local caller may pick an allowed one, and a deployment may not", async () => {
    await (await post({ model: "claude-sonnet-5-5", messages: [userMessage("Hi")] })).text();
    expect(requested.modelId).toBe("claude-sonnet-5-5");

    await (await post({ model: "gpt-4", messages: [userMessage("Hi")] })).text();
    expect(requested.modelId).toBe("claude-haiku-4-5");

    vi.stubEnv("VERCEL_ENV", "production");
    await (await post({ model: "claude-haiku-4-5", messages: [userMessage("Hi")] })).text();
    expect(requested.modelId).toBe("claude-sonnet-5-5");
  });

  it("hides the details of a failure from the browser and logs them", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    makeGraph = () =>
      createAgentGraph({
        agentModel: async () => {
          throw new Error("401 invalid x-api-key sk-ant-secret at api.anthropic.com");
        },
        reflectionModel: fakeReflectionModel([valid]).model,
        systemPromptFor: () => "system",
        toolsFor: () => [],
      });
    const response = await post({ messages: [userMessage("Hi")] });
    const text = await response.text();

    expect(text).toContain("Something went wrong. Please try again.");
    expect(text).not.toContain("sk-ant-secret");
    expect(text).not.toContain("api.anthropic.com");
    expect(logged).toHaveBeenCalled();
  });
});

const visitorA = "3f2b8c1e-9a4d-4e57-8c3b-1d2e3f4a5b6c";
const visitorB = "7a1c9e2d-5b3f-4d68-9e4c-2a3b4c5d6e7f";
const as = (visitor: string) => ({ cookie: `${VISITOR_COOKIE}=${visitor}` });
const ask = (visitor: string) => post({ messages: [userMessage("Hi")] }, as(visitor));

describe("the consumption limits", () => {
  it("records each request of a visitor with what it used", async () => {
    await (await ask(visitorA)).text();

    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]).toMatchObject({
      visitorId: visitorA,
      worldId: "world_aethel",
      modelId: "claude-haiku-4-5",
      promptVersion: "agent.v6",
    });
    // The fake check reports 100 input and 10 output tokens.
    expect(usageRows[0].finished).toMatchObject({
      status: "completed",
      inputTokens: 100,
      outputTokens: 10,
    });
  });

  it("refuses a request over the rate limit with a friendly message, before any model is called", async () => {
    const { agent } = scriptedGraph({ agent: [draft("An answer.")], reflection: [valid] });
    for (let i = 0; i < 3; i++) await (await ask(visitorA)).text();
    const callsBefore = agent.calls.length;

    const response = await ask(visitorA);

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toMatchObject({ error: "rate_limited" });
    expect(body.message).toContain("seconds");
    expect(body.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(response.headers.get("Retry-After")).toBe(String(body.retryAfterSeconds));
    expect(agent.calls.length).toBe(callsBefore);
    // The refused request was not recorded: asking again does not extend the wait.
    expect(usageRows).toHaveLength(3);
  });

  it("refuses a visitor whose daily token budget is spent, and says that waiting a minute will not help", async () => {
    usageRows.push({
      id: "earlier",
      visitorId: visitorA,
      worldId: "world_aethel",
      modelId: "claude-sonnet-5-5",
      promptVersion: "agent.v6",
      createdAt: new Date(Date.now() - 1000),
      finished: finishedWith(1000),
    });
    // Seen through the guard's own store: the budget is 1000 tokens and 1000 are spent.
    const response = await ask(visitorA);

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toMatchObject({ error: "daily_budget" });
    expect(body.message).toContain("midnight UTC");
  });

  it("keeps the visitors apart", async () => {
    for (let i = 0; i < 3; i++) await (await ask(visitorA)).text();
    expect((await ask(visitorA)).status).toBe(429);
    expect((await ask(visitorB)).status).toBe(200);
  });

  it("gives a new visitor a cookie that only the server can read, and an old one none", async () => {
    const first = await post({ messages: [userMessage("Hi")] });
    await first.text();
    const cookie = first.headers.get("Set-Cookie") ?? "";
    expect(cookie).toContain(`${VISITOR_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");

    const again = await ask(visitorA);
    await again.text();
    expect(again.headers.get("Set-Cookie")).toBeNull();
  });

  it("records a run that failed, with what it had used", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    makeGraph = () =>
      createAgentGraph({
        agentModel: async () => {
          throw new Error("provider down");
        },
        reflectionModel: fakeReflectionModel([valid]).model,
        systemPromptFor: () => "system",
        toolsFor: () => [],
      });
    await (await ask(visitorA)).text();

    expect(usageRows).toHaveLength(1);
    expect(usageRows[0].finished?.status).toBe("failed");
  });

  it("does not record a request that is not valid", async () => {
    await post({ messages: [] }, as(visitorA));
    expect(usageRows).toHaveLength(0);
  });
});
