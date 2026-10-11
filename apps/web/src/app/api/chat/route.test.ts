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
      messageMetadata: { modelId: "claude-haiku-4-5", promptVersion: "agent.v3" },
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
