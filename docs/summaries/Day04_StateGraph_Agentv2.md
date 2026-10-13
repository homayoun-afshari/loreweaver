# Day 4: State Graph, Agent v2

The full account is in the [Day 4 report](../reports/day-4.md), and every measured figure is in [METRICS.md](../METRICS.md).

## Tasks Performed

- **State Graph:** a LangGraph graph with agent, tools and reflect nodes, where a second model checks every draft against the tool results, bounded by a revision limit and a time limit.
- **Agent v2:** the chat route runs the graph, shows the cards and a status note as it works and sends the checked answer once; a shorter-answer prompt version and ten prompts that tempt a rule break.

## Documents Involved

- **ADR:** [ADR-0004](../adr/0004-orchestration-vs-ui-streaming.md), orchestration apart from UI streaming, and no checkpointer.
- **Agent Design:** [the agent's design](../AGENT_DESIGN.md): the graph, its state, its bounds, what reflection checks and what reaches the author.
- **Architecture Diagram:** [the agent orchestrator and the reflection model](Day04_StateGraph_Agentv2.svg).
- **Report:** [agentic orchestration with LangGraph](../reports/day-4.md).
- **Metrics:** Updated.

## Decisions Made

- **Orchestration Apart from Streaming:** LangGraph owns state and control flow, and the Vercel AI SDK owns transport and the UI.
- **No Checkpointer:** the graph keeps nothing between requests, and the browser sends the conversation.
- **Bounded Loops:** at most two revisions by default and none after 12 seconds; the best draft then goes out with a caveat built by code.
- **Reflection on Evidence:** a cheaper model at temperature 0 checks the draft only against this run's tool results.
- **Answer Sent Once:** draft text and verdicts never leave the server.

## Metrics Measured

- **Rule Violations:** how often first drafts and final answers break a rule, according to the checker.
- **Reflection Loop:** the revisions per run and how each run ended.
- **Reflection Overhead:** the latency and cost per query, and the share added by the checks and revisions.
