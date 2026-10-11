# Day 4 report: Agentic orchestration with LangGraph

## 1. Summary

Day 4 gave Loreweaver an agent that checks its own work:

- A **LangGraph agent** with three steps: it fetches facts with the two tools, drafts an answer, and a second model **checks the draft** against the world's rules and the character's real inventory before the author sees it.
- **Bounded loops.** A draft that fails the check is revised a limited number of times. After that, or when the run has taken too long, the best draft goes out with a **caveat** that lists what is unresolved.
- The chat route now runs this agent and streams its progress to the same interface: the cards of Days 2 and 3 appear as the tools finish, a short note shows while a draft is checked, and the answer arrives once.
- **ADR-0004** (orchestration is kept apart from UI streaming), a design document for the agent, and **ten prompts** about the seeded characters, most of them written to tempt a rule break.

The model never answers straight from itself any more: every answer passes through a check that uses only what the tools returned for that question.

## 2. Learn, Prepare and Build

| Section                     | What was done                                                                                                                                                                                                                                                    |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Learn**                   | Agents as graphs (state, nodes, edges, cycles, reducers), the ReAct and reflection patterns, bounded autonomy (iteration and recursion limits, an honest fallback), structured output, orchestration versus presentation, and when a checkpointer is not needed. |
| **Prepare**                 | The design of the graph on paper, and four packages installed with exact versions (section 3). One new optional setting, `AGENT_MAX_ITERATIONS`. No new account.                                                                                                 |
| **Build**                   | Five parts: the decision, the graph, the stream to the interface, the latency and robustness work, and the tests with the prompt set.                                                                                                                            |
| **Build A: Decision**       | ADR-0004: LangGraph runs the agent, the AI SDK delivers the result, and the graph keeps no state between requests (no checkpointer).                                                                                                                             |
| **Build B: The graph**      | The state, the agent, tools and reflection nodes, the edges and every bound. The tools were moved into a shared core that both the old and the new layer use.                                                                                                    |
| **Build C: The stream**     | The chat route runs the graph and writes the chat's message stream from its node updates. The interface shows a status note, and the history of a conversation is converted for the graph.                                                                       |
| **Build D: Latency**        | Shorter answers (a new system prompt version), a time limit on revisions, a stricter checker prompt, and fixes to the Stop and Regenerate buttons found on a preview deployment.                                                                                 |
| **Build E: Tests and data** | A test of the whole chat route with fake models, and `evals/agent-prompts.json` with its loader and tests.                                                                                                                                                       |

## 3. By area

**Frontend**

| Item                  | What it is                                                                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatPanel` (changed) | Shows "Thinking…" or the agent's status ("Checking against world rules…") until the answer arrives. Draws a card skeleton only while the chat is busy, so a stopped run leaves no stuck skeleton. |
| `chat-controls.ts`    | When Regenerate shows: after an answer, and also after a question that was stopped before any answer arrived.                                                                                     |
| `ChatMessage`         | The message type shared by the route and the browser (type-only), now with the `status` data part.                                                                                                |

**Backend**

| Item                          | What it is                                                                                                                                                                                           |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/agent/`              | The graph, with no HTTP, React or AI SDK UI code in it: `state.ts`, `nodes.ts`, `graph.ts`, `reflection.ts` (the checker's logic), `messages.ts`, `config.ts` (the bounds), `models.ts`, `tools.ts`. |
| `src/lib/ai/tool-core.ts`     | The two tools' descriptions, input schemas and handlers, shared by the AI SDK tools (`tools.ts`) and the graph's tools. One copy of the logic and of the checks.                                     |
| `src/lib/ai/agent-stream.ts`  | The only place that knows both sides: reads the graph's node updates and writes the chat's message chunks.                                                                                           |
| `src/lib/ai/agent-runtime.ts` | Builds the graph with the real models, prompt and tools, one per drafting model for the life of the process.                                                                                         |
| `src/app/api/chat/route.ts`   | Rewritten around the graph (section 7).                                                                                                                                                              |
| `src/lib/env.ts`              | Reads and validates `AGENT_MAX_ITERATIONS`: a digit from 0 to 5, 2 when unset.                                                                                                                       |
| `src/lib/ai/models.ts`        | A constant for the reflection model, Claude Haiku 4.5, in every environment.                                                                                                                         |
| `src/lib/prompts/agent.v3.md` | The system prompt, version 3: version 2 plus a request for short answers.                                                                                                                            |

**Tooling**

| Item                                                   | What it is                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LangGraph packages                                     | `@langchain/langgraph` 1.4.21, `@langchain/core` 1.2.17, `@langchain/anthropic` 1.5.12 and `@ai-sdk/langchain` 3.0.136, with exact versions. The bridge version matches the app's `ai` 7.0.136 exactly, so only one copy of `ai` is installed.                                                               |
| `src/lib/agent/testing.ts`                             | Scripted fake models for tests, which also record what they were asked.                                                                                                                                                                                                                                      |
| `evals/agent-prompts.ts`                               | Reads and validates the prompt set.                                                                                                                                                                                                                                                                          |
| `scripts/measure-chat.ts`                              | Also counts a tool call that arrives whole as the first sign of the interface.                                                                                                                                                                                                                               |
| `scripts/measure-agent.ts`, `src/lib/agent-metrics.ts` | Runs the prompt set through the graph without a browser and summarizes what the reflection step did: violations found in first drafts and in final answers, revisions, how each run ended, and the time, tokens and cost of checking and revising. The arithmetic is in `agent-metrics.ts`, with unit tests. |

**Documenting**

| Item                              | What it is                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-0004                          | Two decisions: orchestration kept apart from UI streaming, with four options compared; and no checkpointer, with what would change it.               |
| `docs/AGENT_DESIGN.md`            | The agent's design written before the code: graph, state, bounds, what the checker reports, what reaches the author, where the character comes from. |
| `evals/README.md` and `README.md` | The prompt set is described, and the README lists the new optional setting and links the design.                                                     |

## 4. By environment

| Environment | Web app and models                                                                                     | Database and lore                              | CMS                    | Secrets                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| **Dev**     | `pnpm dev`. Drafting: Haiku 4.5 (an allowlisted override works locally). Checking: Haiku 4.5.          | Docker Postgres with the lore ingested (Day 3) | Docker, localhost:8080 | `apps/web/.env.local`, with the optional `AGENT_MAX_ITERATIONS` |
| **Preview** | One Vercel URL per pull request. Drafting: Sonnet 5.5, not changeable by callers. Checking: Haiku 4.5. | Supabase, as before                            | Cloud Run              | Vercel Preview variables, nothing new required                  |
| **Prod**    | Vercel, from `main`. Drafting: Sonnet 5.5. Checking: Haiku 4.5.                                        | The same Supabase project as Preview           | Cloud Run              | Vercel Production variables, nothing new required               |

`AGENT_MAX_ITERATIONS` is optional in every environment: the default is 2, and the Vercel variables are unchanged. Nothing new is stored in any database.

## 5. Routing

Same URLs as Day 3. Only the behavior of one changes.

| URL                               | File (`apps/web/src/app/`)            | Purpose                                                                |
| --------------------------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `/`                               | `(chat)/page.tsx`                     | The chat page                                                          |
| `POST /api/chat`                  | `api/chat/route.ts`                   | **Changed:** runs the agent graph and streams its progress (section 7) |
| `GET`, `POST /api/session/world`  | `api/session/world/route.ts`          | Read and remember the world (Day 3)                                    |
| `POST /api/feedback`              | `api/feedback/route.ts`               | Stores one feedback event (Day 2)                                      |
| `GET /api/health`                 | `api/health/route.ts`                 | Liveness (Day 1)                                                       |
| `GET /api/legacy/character-state` | `api/legacy/character-state/route.ts` | Development fallback, limited to the session's world (Day 3)           |

## 6. Unit tests and CI

**294 tests** (101 new today), Vitest. Almost all need no network, database or key, and none calls a real model.

| Area                     | What is checked                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The graph**            | The facts are fetched, drafted, checked and returned. **A forced rule violation in the first draft is caught, revised and fixed**, and the revision call received the violation. The revision limit, a limit of 0, the model-call limit, the time limit and a check that fails each end the run with the right caveat. The worst case ends under LangGraph's own step limit. Forged history is not evidence. A run without a world fails. |
| **Nodes and routing**    | Every outcome of the reflection node, tool errors that do not leak details, tool calls dropped when not allowed, and both routers.                                                                                                                                                                                                                                                                                                        |
| **The stream**           | Tool progress and one answer in the right order, typed tool parts, a rejected draft and its verdict never in the output, errors as error parts, balanced steps, the metadata.                                                                                                                                                                                                                                                             |
| **The conversation**     | The history the browser sends passes validation against the tools and becomes messages with each tool call followed by its result.                                                                                                                                                                                                                                                                                                        |
| **The route**            | The real route with fake models: bad requests and forged tool parts get 400, the session's world and the model choice are respected, a rejected draft never reaches the response, and a failure is hidden from the browser and logged.                                                                                                                                                                                                    |
| **Settings and prompts** | The new variable (range, default, bad values), the system prompt's key rules, and the checker's instructions.                                                                                                                                                                                                                                                                                                                             |
| **The prompt set**       | The file is valid, has ten prompts, at least half tempting, every character exists in its world and is named in its question.                                                                                                                                                                                                                                                                                                             |
| **The controls**         | When Regenerate shows.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **The measurement**      | How a run is split into drafting, checking and revising; prices by model; how a run ended; violation rates that leave out empty drafts and unavailable checks.                                                                                                                                                                                                                                                                            |

**CI** is unchanged: on every pull request and push to `main` it runs `format:check`, `lint`, `typecheck`, then starts a throw-away Postgres with pgvector, applies the migrations and runs the tests, including the five that need a database (they are skipped on a laptop without one). It does not run `next build`; the Vercel preview does.

## 7. The agent

**Nodes.** The graph is built once. The world arrives with each run, in a configuration that the server sets, so the model cannot read or change it.

| Node        | Does                                                                                                                                                                                                        |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent**   | The drafting model calls `search_lore`, calls `fetch_character_state`, or writes a draft. Its last call of a draft has no tools, so it must answer.                                                         |
| **Tools**   | Runs the tool calls one after the other, scoped to the session's world. A failure becomes an error result, with no internal details.                                                                        |
| **Reflect** | A cheaper model at temperature 0 checks the draft against **this run's tool results only** and returns a structured verdict. (It is named `reflect` because a node cannot share a name with a state field.) |

**Edges.** `START → agent`; `agent → tools → agent` while the model asks for tools; `agent → reflect` once it has written a draft; `reflect → agent` to revise; `reflect → END` otherwise.

**State.** `messages` (appended), `draftAnswer`, `reflection` (the latest verdict) and `iterations` (revisions asked so far), plus `usage`, which every node adds its token counts to, split into drafting and checking.

**Bounds.** Every loop is limited, and the limit ends in an honest caveat, never an error or a silent rule break.

| Bound                 | Value                                                                                          |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Revisions             | `AGENT_MAX_ITERATIONS`, default 2 (0 to 5): at most 3 drafts and 3 checks per run              |
| Model calls per draft | 3, the last with no tools                                                                      |
| Time                  | A run older than 12 s does not start another revision, so the host's 30 s limit is not reached |
| Steps per run         | LangGraph's limit is set from the worst case, as a net under the real exits                    |

**The checker.** It reports a violation for a claim that a retrieved passage forbids, an item or ability the character does not have, a contradiction of the character's state, or a claim the evidence does not support. It does not report omissions, style or limits the draft admits. The verdict lists violations first and then a `valid` flag; a verdict that contradicts itself is repaired (any violation makes it invalid), and one that cannot be read, or a check that fails, ends the run with a caveat that says so instead of triggering a revision. The caveat is built by code from the verdict, so a model cannot soften it. Its instructions are `reflection.v2`, a constant in `reflection.ts`.

**What reaches the author.** Draft text, verdicts and revisions never leave the server. Two layers keep it so: the route streams only node updates, and both models run with streaming switched off.

| Moment                                | What is sent                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------ |
| The agent asks for tools              | A typed tool call per request, so the card skeletons appear                          |
| A tool is done                        | Its result as a typed tool part, or an error part if the tool failed                 |
| A draft is ready, about to be checked | A transient status note, "Checking against world rules…", never kept in the messages |
| The run ends                          | The answer in one text part, then the metadata                                       |

The metadata of an answer has the drafting model and the prompt version, the drafting model's token counts, the reflection model's token counts and the server timing.

**The route.** It validates the request, reads the world from the session, checks the earlier tool parts of the conversation against the tools, converts the conversation for the graph (with `@ai-sdk/langchain`, the only use of the bridge), runs the graph with the request's abort signal, and replaces any provider error with one generic message.

## 8. What the UI can do

| Capability        | Detail                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat              | As before (Enter sends, history in the browser). The answer arrives once, after the check, in plain text.                                                                              |
| Waiting           | "Thinking…", then the cards as they arrive, then "Checking against world rules…" until the answer.                                                                                     |
| Control           | **Stop** cancels the run and the model calls. **Regenerate** redoes the last answer, and is also offered after a question stopped before any answer. **Retry** appears after an error. |
| Cards             | The Character Status Card and the Lore Citation cards, drawn from typed tool parts. Every tool call of a run is shown, including those of a draft that was revised.                    |
| Caveat            | An answer that could not be fully verified ends with a note listing what is unresolved.                                                                                                |
| Not available yet | Streaming of the answer text, history across reloads, sign-in, a way to choose the character.                                                                                          |

## 9. The agent prompt set

`evals/agent-prompts.json` has ten questions about the seeded characters: seven written to tempt the agent into breaking a rule or using what the character does not carry (a ban with an exception, an old price, a request into the other world, a spell that costs more mana than the character has) and three plain ones (a request that should be allowed, a conflict between the CMS and the lore, and a state-only question). Each entry has the tools a good run should use and a note saying what is right. The set is checked against the lore and the CMS seed data, and it is documented in `evals/README.md`.

## 10. Additional items and known limits

**Additional items**

- The tools were moved into a shared core, so the AI SDK and the graph run the same handlers and checks.
- The graph's models run with streaming switched off, which the checker's structured reply also needed: with streaming on, its reply failed to parse.
- A time limit on revisions, to keep a run inside the host's 30 s limit.
- The last model call of a draft, which has no tools, is told so and asked to answer from the results it has. Without the note, Claude Sonnet 5.5 could end that call with only a thinking block and no text, which the checker then reported as an empty answer.
- A shorter-answers system prompt (`agent.v3`) and a stricter checker prompt (`reflection.v2`), after live runs showed long answers and rejections for omissions and for a wrong calculation.
- Token usage kept per kind in the graph's state and in the message metadata, for the measuring scripts.
- A check of the stream of tool results with the real CMS, lore database and models, and a look at a preview deployment, found two interface bugs: a skeleton left after Stop, and no Regenerate after an early Stop. Both are fixed.
- Not built: tracing (the next day), human-in-the-loop, a router in front of the agent, deterministic checks for hard rules (the inventory could be compared as text).

**Known limits**

- **The answer starts later.** It cannot start before the check, and it arrives in one piece, so the time to the first text is the whole run. The cards and the status note soften the wait. How long it takes is measured separately.
- **The checker is a model and can be wrong.** It can reject a good draft or accept a bad one, and it grades the agent it belongs to. An independent judge comes later.
- **A caveat can come from a false rejection**, and a run past the time limit gets one without a second draft.
- **No checkpointer.** A run cannot be paused or resumed, and the conversation is whatever the browser sends. Facts are therefore checked against the tools' results, never against earlier messages.
- **The character is still chosen by the model** from the world's list, not from the session.
- **Every tool call is shown as a card**, so a revision that searches again adds more cards.
- **The metadata counts the drafting model's tokens and the checker's tokens separately**, so a script that prices an answer has to add both at their own prices.
- **Preview and Production share one Supabase project**, as on Day 3, so they share the lore.
- The five database tests run only in CI.
