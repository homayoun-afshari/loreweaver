# ADR-0004: Keep orchestration (LangGraph) separate from UI streaming (Vercel AI SDK), and run the graph without a checkpointer

This record covers two linked decisions about the agent: which library runs the agent's steps and which one delivers the result to the browser, and whether the agent saves its state between requests.

Loreweaver's agent fetches a character's live state, searches the lore, drafts an answer and checks the draft against the world's rules before the author sees it (see [PRD](../PRD.md) and [Agent design](../AGENT_DESIGN.md)). Until now one library did everything: the chat route calls the AI SDK's `streamText` with the two tools, and that one call runs the model and tool loop and also produces the stream the browser reads. The reflection step is new: it must finish before any answer text is sent, and the loop needs bounds and tests of its own.

## 1. Who runs the agent, and who delivers the result

### Context

Two jobs are mixed in today's route (`apps/web/src/app/api/chat/route.ts`):

- **Orchestration:** what the agent does and in which order. The model decides, a tool runs, the model decides again, and now a draft is checked and possibly revised.
- **Presentation:** how the result reaches the screen. Text and tool parts become a message stream, `useChat` reads it, and the typed tool parts become the character card and the lore citation cards.

With a single tool loop and nothing between the model and the stream, one library doing both was the simplest correct design. Reflection changes that:

- It needs a step that runs **before** any text is sent, and a loop that is **bounded** and ends in a caveat, not in an error.
- The agent has to be run **without a browser**: by tests, by a measuring script, and later by the evals. Today the only way to run it is to call the HTTP route and read its stream.
- The agent should be **traced step by step**, and its steps tested one by one with fake models.
- The chat UI (the cards, the stream format, `useChat`) works and must keep working. It should be possible to change it without touching the agent's rules, and the other way around.

Constraints: TypeScript end to end, an agent that can be tested without a network, a short time to market, and a function time limit on the route (`maxDuration` of 30 s).

### Options considered

1. **Keep the AI SDK's loop and add reflection around it.** `streamText` stays the orchestrator, and the draft is checked by an extra model call before or after it.
   - Pros: no new dependency; streaming, tool parts, the step limit, abort and error handling come for free; nothing to migrate.
   - Cons: the control flow lives in the route handler and in stream options, tied to the HTTP request. The draft is the stream, so holding it back until it is checked means working against the library. A revision loop becomes nested calls with no names, which is hard to test one step at a time, to bound cleanly or to trace. Running it headlessly means going through HTTP.

2. **A hand-written loop in plain TypeScript, with the AI SDK only for the UI.**
   - Pros: no framework to learn; full control; every line is ours.
   - Cons: we would write and test the state handling, the cycle and the bounds ourselves, and add tracing by hand. The result is a private, smaller version of a graph library, with no shared vocabulary for the people who read it.

3. **LangGraph for orchestration, the AI SDK for transport and UI, joined by a small bridge.** The graph has named nodes (agent, tools, reflection), a typed state and explicit edges. It runs on its own; the route turns its stream into the AI SDK's message stream with `@ai-sdk/langchain`.
   - Pros: every step is a function that can be tested with a fake model; the cycle and its bounds are written down as edges and checked by a test; the graph runs headlessly; its steps show up in traces; the UI stays as it is, so the cards keep working.
   - Cons: a new library family and a bridge to maintain (30 more packages in the lockfile); the loop, and some things `streamText` gave for free, have to be rebuilt around it.

4. **LangGraph end to end, including its own client for the browser.**
   - Pros: one vendor's model for state, streaming and UI; no bridge.
   - Cons: it replaces `useChat`, the stream format and the typed tool parts that the cards already use, for no gain in v1. It ties the interface to the same library as the agent, which is the coupling this decision is meant to avoid.

### Decision

Option 3: **LangGraph owns state and control flow; the AI SDK owns transport and UI.** The boundary is a dependency rule:

- The agent code (`apps/web/src/lib/agent/`) knows nothing about HTTP, `Request` and `Response`, React or the AI SDK's UI types. Its input is a list of messages and a configuration (the world id, taken from the session); its output is a stream of graph events. It can be called from a test or a script.
- The chat route is the only place that knows both sides. It keeps what it does today: validates the request, reads the world from the session, builds the tools, hides provider errors and returns the stream. It runs the graph and converts the events with the bridge.
- The existing tools (`search_lore`, `fetch_character_state`) are wrapped as graph tools. Their Zod schemas carry over, so the arguments are still validated, and the world stays inside the tool, out of the model's reach (see [ADR-0003](0003-chunking-and-retrieval.md)).
- **Text is held back, tool progress is not.** The tool parts reach the browser as they happen, so the cards appear while the graph works. Draft text and the reflection verdict are never sent; the answer is sent once, after reflection accepts it or the revision limit is reached. [Agent design](../AGENT_DESIGN.md) has the rules.

The reason is the new step. A check that must finish before the answer is sent, a loop that must be bounded and a run that must work without a browser fit a graph. Keeping the stream and the UI parts in the AI SDK means the cards, `useChat` and the typed tool parts do not change.

### Consequences

**Positive**

- The agent is tested without a browser or a network: each node with a fake model, the loop with a forced rule violation, the bound with a draft that can never pass.
- The same graph is called by the chat route, by measuring scripts and, later, by an eval runner. There is one agent, and the stream is a view of it.
- The interface and the agent can change independently.
- Each step of a run can be traced on its own.

**Negative / costs**

- **The first answer token comes later.** The answer cannot start before the check ends, so the time to the first token of a chat is longer than before. The tool progress and a short status line ("Checking against world rules…") soften it. How much it grows is measured.
- **A worst case that can multiply latency and cost.** A question can go through several drafts and reflections before it ends. The bounds in [Agent design](../AGENT_DESIGN.md) keep it finite, but the worst case has to fit in the route's 30 s function limit, and that is not yet shown.
- **Things `streamText` gave for free are rebuilt:** the step limit, the abort when the user presses Stop, the timing metadata that the measuring scripts read, and the masking of provider errors.
- **A version coupling:** the bridge depends on one exact `ai` version. The AI SDK packages and the bridge must be upgraded together.
- **Two vocabularies** (graph and stream) for a reader to learn. If the product only ever needed one tool loop, the AI SDK alone would be simpler.
- **Unverified in the installed libraries:** how the graph's stream mode treats model calls inside nodes (to hold the text back), and the bridge's handling of tool parts for the existing cards.

### Follow-ups

- Prove with a test that a rejected draft and the verdict never reach the stream, and that the cards still render from the bridged tool parts.
- Measure the time to the first token, the cost and the latency of the new loop against the old route (`docs/METRICS.md`).
- Check the worst case against the 30 s function limit, and change either the limit or the bounds if it does not fit.
- Move the guards that are not specific to the AI SDK (abort, error masking, timing) into code that both the route and the scripts can use.

## 2. No checkpointer: the graph keeps nothing between requests

### Context

A **checkpointer** saves the graph's state after each step under a thread id, so a run can be resumed, rewound or paused for a person. Loreweaver's v1 has no feature that needs it: the browser keeps the conversation and sends all of it with every request, and the tools read the character state and the lore again each time. Each run therefore starts from the messages it is given and ends with an answer.

Related facts:

- The history in a request can be forged by the browser (a known limit of the chat route). The agent must not trust it for facts, so its check uses the results of this run's tools.
- Nothing about a conversation is stored on the server except feedback events (message ids, no text).
- There is no sign-in, so there is no owner to attach a stored conversation to.

### Options considered

1. **No checkpointer; the client sends the conversation.**
   - Pros: nothing new to store, secure or delete; no thread ids, no retention policy; works the same on every serverless instance.
   - Cons: a run cannot be resumed or paused; the history is whatever the browser sends.

2. **An in-memory checkpointer.**
   - Pros: no database; useful in tests.
   - Cons: it lives in one process, and a serverless function may handle each request on a different instance, so a saved state would often not be there. It gives a false sense of persistence in the cloud.

3. **A Postgres checkpointer** (the LangGraph package for it) in the existing database.
   - Pros: survives restarts and instances; enables pausing for a human and resuming; the server could hold the conversation.
   - Cons: a table of conversation state, which holds the author's questions and the passages of their unpublished lore; thread ids, ownership, retention, deletion and an access rule that keeps worlds apart; and a migration. None of it serves a v1 feature.

### Decision

Option 1: **no checkpointer.** The graph is stateless between requests, and the client keeps sending the conversation.

**What would change it:**

| Need                                                                  | Why it needs persistence                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Ask the author which of two conflicting rules is canon, then continue | The run must stop, wait for a person and resume from the same state      |
| Resume a long run after a failure or a function timeout               | The state must outlive the function that was running it                  |
| A server-held conversation (sign-in, history across reloads)          | The server, not the browser, becomes the source of the conversation      |
| Protection against a forged history                                   | The server must be the only writer of what the model is shown as history |

### Consequences

**Positive**

- No new stored data, so nothing new to protect, retain or delete. The privacy position of v1 does not change.
- The agent is easy to run anywhere, including a script, because its input is only the messages and the configuration.

**Negative / costs**

- No human-in-the-loop and no resumable runs.
- The history can be forged. The reflection step therefore checks drafts against the tool results of the current run and never against earlier messages.
- A run has to end inside one function call, so it is bounded in time as well as in steps.

### Follow-ups

- When sign-in exists, or when a feature needs a pause or a resume: a Postgres checkpointer, with thread ids that belong to one author and one world, a retention period and deletion with the rest of the world's data.
- Re-read this record when ambiguous lore is handled by asking the author instead of by a caveat.
