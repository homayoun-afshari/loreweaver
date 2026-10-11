# ADR-0002: Use Claude Sonnet 5.5 for the agent in Preview and Production, and Claude Haiku 4.5 in development

This record covers one decision: which model the agent uses in each environment.

## 1. The agent's model per environment

### Context

The agent node is the part of Loreweaver that writes the answers: it reads tool results (character state, later lore), follows the world's rules and produces suggestions for the author (see [PRD](../PRD.md)). The model behind it sets answer quality, how fast the first words appear, and the cost of every question. We have to decide which model it uses, and in which environment.

Constraints:

- The PRD guardrails: **p95 latency under 8 s** from question to complete answer, and **cost per query under $0.05**.
- Answers must follow instructions (length, format) and must not invent facts about the author's world. A made-up fact is the continuity error the product exists to prevent.
- Users feel the time to the first token, not the total time, so the start of the stream matters most.
- The project has a small API budget (about USD 15 to 20 in total), so day-to-day development must use a cheap model.
- Public leaderboards test other tasks. The choice should rest on our own prompts.

Evidence: a [mini model benchmark](../BENCHMARK.md) of 5 Loreweaver-style prompts on two models, through the real chat route. Numbers and caveats are in [METRICS.md](../METRICS.md).

| Measured on 5 prompts, 1 run each |   Haiku 4.5 |  Sonnet 5.5 |
| --------------------------------- | ----------: | ----------: |
| Average quality (1 to 5)          |         3.8 |         4.6 |
| Average time to first token       |      669 ms |     1346 ms |
| Average / slowest total time      | 2.4 / 4.7 s | 4.0 / 6.3 s |
| Average cost per answer           |     $0.0008 |     $0.0036 |

### Options considered

1. **Claude Haiku 4.5 everywhere.**
   - Pros: fastest start and finish, about 4x cheaper per answer, best fit for the 8 s budget.
   - Cons: lower quality on the prompts that matter most here. It broke length and format limits, gave generic ideas and explained a rule check less clearly. Quality is the product, and the gap is the largest in instruction following.

2. **Claude Sonnet 5.5 everywhere, including development.**
   - Pros: one model in every environment, so nothing behaves differently between laptop and production.
   - Cons: about 4x the cost per answer for all the repeated runs and experiments of the next five days, in a budget meant to stay around $15 to $20 in total.

3. **Claude Haiku 4.5 in development and Claude Sonnet 5.5 for the agent in Preview and Production.**
   - Pros: the higher quality where users see it, a low cost while building. A preview shows what would ship.
   - Cons: behaviour can differ between a laptop and the cloud, so a prompt tuned on Haiku may need a check on Sonnet. Everything meant to be judged (evals, latency numbers) must run against the Preview and Production model.

4. **A larger model, Claude Opus 5.5, for the agent.**
   - Pros: probably the best quality.
   - Cons: not measured here. It would be slower and more expensive, so it would put the latency and cost guardrails at more risk. Kept for the LLM judge on Day 6, where answer speed does not matter.

### Decision

Build option 3. The model is chosen in one place, `apps/web/src/lib/ai/models.ts`:

- **Development (a local machine):** Claude Haiku 4.5. A local caller may ask for the other allowlisted model, which is how the benchmark compares them.
- **Preview and Production:** Claude Sonnet 5.5. A request can never change it: the model override is ignored there, so a visitor cannot pick the model or its cost.

The decision rests mainly on quality: 4.6 against 3.8, with the gap in instruction following. Both models refused to invent a character's name, so honesty did not separate them. Cost is not the constraint: at about $0.0036 per answer, a single call uses roughly 7% of the $0.05 budget. The risk is latency, see below.

### Consequences

**Positive**

- Better answers in the environments that users and reviewers see.
- Low cost during development, and a single place to change a model or a price.
- The model cannot be changed from the outside in the cloud.

**Negative / costs**

- **The 8 s latency budget is not proven.** One plain Sonnet answer took up to 6.3 s, and a real answer adds the legacy CMS call (about 1.5 s at p95) and a model step to choose the tool. A multi-step agent could exceed 8 s at p95. Mitigations: stream, so the user sees the Character Status Card and the first words early; keep answers short (concise instructions, an output limit); keep the reflection loop bounded; and use Haiku for cheap steps if the measurement requires it. With one tool call on Production (Sonnet, 30 runs), a chat took a median of 3.1 s and a p95 of 4.4 s from question to complete answer (see [METRICS.md](../METRICS.md)): inside the 8 s budget, which eases the risk for a one-tool question. One run in 50 across three Production batches took 10.7 s, because the legacy CMS call took about 8.6 s: the tail comes from the CMS, not the model, and needs attention (see Day 5). The full agent, with several tool calls and a reflection step, still has to be measured.
- **Cost grows with the agent.** One call is cheap, but the agent makes several calls with a growing context. The budget of $0.05 has room (about 14 single answers), and it is checked again when the agent exists.
- **Sonnet writes longer answers** (about 2.2x the tokens of Haiku), which adds latency and cost beyond the price difference.
- **Evidence is thin:** 5 prompts, 1 run, one reader scoring, no tools, run on a laptop. It is enough to choose a direction, not to promise a number.

### Follow-ups

- Measure the p95 latency and cost per query of the full agent on Day 4 and Day 5. **Revisit this ADR if p95 exceeds 8 s, or if cost per query exceeds $0.05.**
- Re-score quality with an LLM judge (Opus 5.5) and a larger set of prompts on Day 6, and compare Haiku again with a better prompt.
- Add a fallback model for when the primary fails or times out (not built on Day 2): Haiku is the natural candidate.
- Check the provider's data-handling terms before any real user data is sent (the PRD rules out training on user data).
