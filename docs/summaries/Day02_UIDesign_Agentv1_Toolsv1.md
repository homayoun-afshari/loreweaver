# Day 2: UI Design, Agent v1, and Tools v1

The full account is in the [Day 2 report](../reports/day-2.md), and every measured figure is in [METRICS.md](../METRICS.md).

## Tasks Performed

- **UI Design:** a streaming chat page with Stop and Regenerate, the Character Status Card with its loading, loaded and error states, feedback buttons and an AI-generated label.
- **Agent v1:** a chat route that streams Claude's answer, with request validation, masked provider errors, a model chosen per environment and a versioned system prompt.
- **Tools v1:** `fetch_character_state`, which reads a character's live state from the legacy CMS.

## Documents Involved

- **ADR:** [ADR-0002](../adr/0002-model-choice.md), the agent's model in each environment.
- **Benchmark:** [the model benchmark](../BENCHMARK.md): its scope, the five prompts, the scoring rubric and every answer.
- **Architecture Diagram:** [the chat, the model layer, the first tool and the feedback database](Day02_UIDesign_Agentv1_Toolsv1.svg).
- **Report:** [model layer, streaming and Generative UI](../reports/day-2.md).
- **Metrics:** Updated.

## Decisions Made

- **Model per Environment:** Claude Haiku 4.5 in development and Claude Sonnet 5.5 in Preview and Production, chosen mainly on quality; a request cannot change it there.
- **State from the Tool Only:** the model never invents character state, and the card shows the CMS data as received.
- **Feedback Without Text:** thumbs and copy clicks are stored in Postgres with ids, the model and the prompt version, never the text.
- **Versioned Prompt:** the system prompt lives in a versioned file, so every answer can be tied to its version.

## Metrics Measured

- **Model Benchmark:** time to first token, total latency, output tokens, cost and quality of two models on the same five prompts.
- **Time to First UI:** when the stream starts, the card appears and the first token and the full answer arrive, locally and on Production.
