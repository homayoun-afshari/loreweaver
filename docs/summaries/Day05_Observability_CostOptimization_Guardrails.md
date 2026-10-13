# Day 5: Observability, Cost Optimization, and Guardrails

The full account is in the [Day 5 report](../reports/day-5.md), and every measured figure is in [METRICS.md](../METRICS.md).

## Tasks Performed

- **Observability:** every agent run traced in LangSmith, labeled with the environment, the model and the prompt version.
- **Cost Optimization:** `pnpm cost:report`, which prices every model call from the traces, and prompt caching of the tool definitions and the system prompt.
- **Guardrails:** a usage table, a visitor cookie, a rate limit and a daily token budget per visitor, with a clear message and no model call over a limit.

## Documents Involved

- **ADR:** [ADR-0002](../adr/0002-model-choice.md) updated: caching was tried and the p95 latency is still above its goal, so the model choice is to be revisited.
- **Architecture Diagram:** [tracing in LangSmith and the usage database](Day05_Observability_CostOptimization_Guardrails.svg).
- **Report:** [observability, token economics and performance](../reports/day-5.md), including the decisions behind the limits.
- **Metrics:** Updated.

## Decisions Made

- **Tracing Setup:** LangSmith in the EU region, one project for development and Preview and one for Production, with traces sent after the response.
- **Pricing per Call:** every model call is priced by the model that made it, with the prices kept in code with their date.
- **One Optimization:** prompt caching of the drafting model, which helps Sonnet only.
- **Visitor Limits:** a random visitor id in an HttpOnly cookie, 10 requests a minute and 200,000 tokens a UTC day, checked before the agent runs.
- **Fail Open:** if the usage database fails, the request goes through and the failure is logged.

## Metrics Measured

- **Cost per Query:** the tokens and cost of a question by kind of token and by step, and a monthly projection.
- **Latency and Time to First Token:** how long a question takes through the graph and when its first word arrives, compared with Day 2.
- **Prompt Caching:** the cost, cache hit rate, time to first token and latency before and after caching.
