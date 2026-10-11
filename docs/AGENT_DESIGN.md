# Agent design

The design of the agent that answers an author's questions: a graph with three nodes (agent, tools and reflection) that drafts an answer from the lore and the live character state, checks it against the world's rules, and revises it a bounded number of times. This document is written before the code and says what the code must do.

## Goal

An answer must use the author's own rules and only the items the character really carries. The agent therefore never answers straight from the model: it fetches facts with the two tools, drafts, and a separate check decides whether the draft may reach the author.

## The graph

```text
START ──▶ agent ──▶ tools ──▶ agent          (the model asked for a tool; observations go back)
            │
            └─────▶ reflection ──▶ END       (valid, or the revision limit was reached)
                        │
                        └──▶ agent           (invalid and below the limit: revise)
```

| Node           | Reads                                                | Does                                                                                                                                                 | Writes                                             |
| -------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Agent**      | `messages`, and the `reflection` feedback if present | The drafting model calls `search_lore`, calls `fetch_character_state`, or writes a draft                                                             | `messages`, `draftAnswer`                          |
| **Tools**      | The tool calls of the last message                   | Runs the existing tools, scoped to the session's world, and returns their results                                                                    | `messages`                                         |
| **Reflection** | `draftAnswer` and this run's tool results            | A cheaper model at temperature near 0 returns a structured verdict. At the limit, the node appends the caveat to the draft by code, not by the model | `reflection`, `iterations`, `draftAnswer` (caveat) |

## State and configuration

| Field         | Holds                                                                     | Merge rule                 |
| ------------- | ------------------------------------------------------------------------- | -------------------------- |
| `messages`    | The conversation, with tool calls and tool results                        | Append                     |
| `draftAnswer` | The latest draft                                                          | Replace                    |
| `reflection`  | The verdict: `{ valid: boolean, violations: { rule_id, explanation }[] }` | Replace                    |
| `iterations`  | How many revisions were requested                                         | Replace with the new count |

The **configuration** of a run is set by the server and is not part of the state, so the model can neither read nor change it. It holds the world id, taken from the session as for every other request.

## Decisions

### Bounded loops

- **The limit counts revisions.** `AGENT_MAX_ITERATIONS` (default 2) is the most times a draft may be sent back. A run therefore has at most 3 drafts and 3 reflections. The common case is one draft and one reflection.
- **The agent and tools cycle is bounded too:** at most 3 model calls for one draft, as the chat route's step limit does today. A cycle that only waits for the model to stop calling tools is not a bound.
- **The framework's recursion limit is a safety net, not the exit.** It is set explicitly from the worst case above, so a legitimate run never reaches it, and a test proves the revision limit ends the run first.
- **At the limit the answer still goes out, with a caveat.** The caveat lists the unresolved violations. It is built by code from the verdict, so a model cannot soften it. The run never ends in an error and never in a silent rule break.

### What reflection checks, and against what

- Reflection receives the draft and **the tool results produced in this run**: the retrieved passages and the character's state. It never trusts earlier messages for facts, because the browser sends the history and can forge it.
- A claim about a rule, an item or a location that the evidence does not support is a violation (`unsupported`), as is an item the character does not carry and a suggestion that breaks a retrieved rule.
- When the run has **no tool results**, reflection still runs. A draft that makes such claims is sent back, and the feedback tells the agent to call the tools first. A draft that makes none (for example, a question outside the product's scope) passes.
- The verdict is structured and validated with the same schema library as the tool inputs. A verdict that fails validation counts as invalid, so a malformed reply cannot end the loop early.

### What reaches the author, and when

- **Tool progress streams as it happens.** The tool call parts reach the browser immediately, so the character card and the lore citations appear while the graph keeps working.
- **Text is held back until it is accepted.** Draft text and verdicts are never sent. The answer is sent once, after reflection accepts it or the limit is reached. A rejected draft never reaches the stream, and a test proves it.
- **The cost is a later first token.** The answer cannot start before the check ends. A short status line, "Checking against world rules…", makes the wait visible.

### Where the character comes from

The world comes from the session and is part of the configuration. The **character does not**: the author names a character in the question, the model passes its id to the tool, and the tool refuses any character of another world, as it does today. The session has no notion of a selected character, and adding one would mean a new selector in the interface for no gain in v1.

### No stored state between runs

The graph keeps nothing between requests: the browser sends the conversation with every request, so each run starts from the messages it is given. There is no checkpointer. One would be needed to pause a run and ask the author a question, to resume a run after a failure, or to keep conversations on the server.

## Out of scope

A router that classifies requests before the agent, several cooperating agents, deterministic checks in code for the hard rules (the inventory could be compared as text), and a second provider for the reflection model.
